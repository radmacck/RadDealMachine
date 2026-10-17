import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import * as contract from "@workspace/api-zod";
import { DomainError } from "@workspace/deal-domain";
import { authenticated, membership, roles, sensitiveWorkspaceData } from "../middlewares/access";
import * as store from "../services/deal-store";
import * as access from "../services/access";
import * as offers from "../services/offer-store";
import { commandCenter } from "../services/command-center";
import { intakePropertyEvidence } from "../services/evidence-intake";
import * as sellerContacts from "../services/seller-contact-store";
import * as sellerContactEnrichment from "../services/seller-contact-enrichment";
import * as acquisitionQueue from "../services/acquisition-queue-store";
import * as sellerPlaybooks from "../services/seller-playbook-store";
import { propagateStaleTransactionDocuments } from "../services/transaction-store";
import { exportDealEvidencePacket } from "../services/evidence-packet";
import { listOperationalAlerts, updateOperationalAlert } from "../services/operational-alerts";

const router: IRouter = Router();
// Trim strings before schema validation so required fields cannot be whitespace-only.
function clean(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clean(v)]));
  return value;
}
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(clean(value));
  if (!parsed.success) throw new DomainError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),400);
  return parsed.data;
}
function leadId(req: Request) {
  return parse(contract.GetLeadParams,req.params).id;
}
function send<T extends z.ZodType>(res: Response, schema: T, value: unknown, status = 200) {
  res.status(status).json(schema.parse(value));
}
const research = roles("OWNER","ANALYST");
const operate = roles("OWNER","OPERATOR");
const contactResearch = roles("OWNER","ANALYST","OPERATOR");
router.use(authenticated);
router.get("/access",async (_req,res) => {
  send(res,contract.GetAccessResponse,await access.getAccess(String(res.locals.actor)));
});
router.post("/access",async (_req,res) => {
  send(res,contract.ClaimWorkspaceResponse,await access.claimWorkspace(String(res.locals.actor)));
});
router.use(membership);
router.use(sensitiveWorkspaceData);
router.post("/leads/:id/evidence-intake",research,async(req,res)=>{
  send(res,contract.IntakePropertyEvidenceResponse,await intakePropertyEvidence(leadId(req),parse(contract.IntakePropertyEvidenceBody,req.body),
    {id:String(res.locals.actor),role:String(res.locals.role)}));
});
router.get("/command-center",async (_req,res) => {
  send(res,contract.GetCommandCenterResponse,await commandCenter(String(res.locals.role)));
});
router.get("/alerts",roles("OWNER","OPERATOR","ANALYST"),async (_req,res) => {
  const center=await commandCenter("OWNER");
  res.json(await listOperationalAlerts(center.actions,new Date(),String(res.locals.role)));
});
router.patch("/alerts/:id",operate,async (req,res) => {
  const parsed=z.object({decision:z.enum(["DISMISS","SNOOZE"]),snoozedUntil:z.string().datetime().optional()}).safeParse(clean(req.body));
  if(!parsed.success)throw new DomainError("Invalid alert action.",400);
  res.json(await updateOperationalAlert(parse(z.string().uuid(),req.params.id),parsed.data.decision,
    {id:String(res.locals.actor),role:String(res.locals.role)},parsed.data.snoozedUntil?new Date(parsed.data.snoozedUntil):undefined));
});
router.get("/members",roles("OWNER"),async (_req,res) => {
  send(res,contract.ListMembersResponse,await access.listMembers());
});
router.patch("/members/:id",roles("OWNER"),async (req,res) => {
  const {id} = parse(contract.UpdateMemberParams,req.params);
  send(res,contract.UpdateMemberResponse,await access.updateMember(id,parse(contract.UpdateMemberBody,req.body),String(res.locals.actor)));
});
router.get("/dashboard",async (_req,res) => send(res,contract.GetDashboardResponse,await store.dashboard()));
router.get("/leads",async (_req,res) => send(res,contract.ListLeadsResponse,await store.listLeads()));
router.post("/leads",research,async (req,res) => {
  send(res,contract.CreateLeadResponse,await store.createLead(parse(contract.CreateLeadBody,req.body),String(res.locals.actor)),201);
});
router.get("/leads/:id",async (req,res) => send(res,contract.GetLeadResponse,await store.leadDetail(leadId(req))));
router.get("/leads/:id/evidence-packet",roles("OWNER","ANALYST","OPERATOR"),async(req,res)=>{
  const purpose=parse(z.enum(["INTERNAL_REVIEW","OWNER_AUDIT","TITLE_HANDOFF","LEGAL_REVIEW","BUYER_HANDOFF"]),req.query.purpose);
  const includeSensitive=req.query.includeSensitive==="true";
  const packet=await exportDealEvidencePacket(leadId(req),{id:String(res.locals.actor),role:String(res.locals.role)},purpose,includeSensitive);
  res.setHeader("Content-Type","application/json");
  res.setHeader("Content-Disposition",`attachment; filename="deal-evidence-${leadId(req)}-v${packet.export.version}.json"`);
  res.json(packet);
});
router.get("/leads/:id/seller-playbook",async (req,res) => {
  send(res,contract.GetSellerPlaybookResponse,await sellerPlaybooks.getSellerPlaybook(leadId(req)));
});
router.put("/leads/:id/seller-playbook/:slug",roles("OWNER"),async (req,res) => {
  const {id,slug} = parse(contract.UpdateSellerPlaybookEntryParams,req.params);
  const body = parse(contract.UpdateSellerPlaybookEntryBody,req.body);
  send(res,contract.UpdateSellerPlaybookEntryResponse,await sellerPlaybooks.updateSellerPlaybookEntry(
    id,slug,body.expectedVersion,body.changeReason,body.content,String(res.locals.actor),
  ));
});
router.get("/leads/:id/contact-paths",contactResearch,async (req,res) => {
  send(res,contract.GetSellerContactPathsResponse,await sellerContacts.getSellerContactPaths(leadId(req)));
});
router.post("/leads/:id/contact-paths",contactResearch,async (req,res) => {
  const id=leadId(req);
  const result=await sellerContacts.recordSellerContactObservation(id,parse(contract.RecordSellerContactObservationBody,req.body),
    {id:String(res.locals.actor),role:String(res.locals.role)},
  );
  await propagateStaleTransactionDocuments(id);
  send(res,contract.RecordSellerContactObservationResponse,result);
});
router.get("/leads/:id/contact-enrichment",research,async (req,res) => {
  send(res,contract.GetSellerContactEnrichmentResponse,
    await sellerContactEnrichment.getSellerContactEnrichment(leadId(req)));
});
router.post("/leads/:id/contact-enrichment",research,async (req,res) => {
  send(res,contract.RequestSellerContactEnrichmentResponse,
    await sellerContactEnrichment.requestSellerContactEnrichment(
      leadId(req),
      parse(contract.RequestSellerContactEnrichmentBody,req.body),
      {id:String(res.locals.actor),role:String(res.locals.role)},
    ));
});
router.patch("/leads/:id",research,async (req,res) => {
  const id=leadId(req), result=await store.updateLead(id,parse(contract.UpdateLeadBody,req.body),String(res.locals.actor));
  await propagateStaleTransactionDocuments(id);
  send(res,contract.UpdateLeadResponse,result);
});
router.post("/leads/:id/intelligence",research,async (req,res) => {
  const id=leadId(req), result=await store.addIntelligence(id,parse(contract.AddIntelligenceBody,req.body),String(res.locals.actor));
  await propagateStaleTransactionDocuments(id);
  send(res,contract.AddIntelligenceResponse,result,201);
});
router.put("/leads/:id/underwriting",research,async (req,res) => {
  const id=leadId(req), result=await store.saveUnderwriting(id,parse(contract.SaveUnderwritingBody,req.body),String(res.locals.actor));
  await propagateStaleTransactionDocuments(id);
  send(res,contract.SaveUnderwritingResponse,result);
});
router.post("/leads/:id/transition",roles("OWNER","ANALYST","OPERATOR"),async (req,res) => {
  const id=leadId(req);
  const input = parse(contract.TransitionLeadBody,req.body);
  const result=await store.transitionLeadForActor(id,input,{id:String(res.locals.actor),role:String(res.locals.role)});
  await propagateStaleTransactionDocuments(id);
  send(res,contract.TransitionLeadResponse,result);
});
router.post("/leads/:id/calls",operate,async (req,res) => {
  const id=leadId(req), result=await store.recordCall(id,parse(contract.RecordCallBody,req.body),String(res.locals.actor));
  await propagateStaleTransactionDocuments(id);
  send(res,contract.RecordCallResponse,result,201);
});
router.post("/leads/:id/buyer-calls",operate,async(req,res)=>{
  const id=leadId(req),result=await store.recordBuyerCall(id,parse(contract.RecordBuyerCallBody,req.body),String(res.locals.actor));
  send(res,contract.RecordBuyerCallResponse,result,201);
});
router.patch("/leads/:id/buyer-calls/:callId/follow-up",operate,async(req,res)=>{
  const {id,callId}=parse(contract.UpdateBuyerCallFollowUpParams,req.params);
  const result=await store.updateBuyerCallFollowUp(id,callId,parse(contract.UpdateBuyerCallFollowUpBody,req.body),String(res.locals.actor));
  send(res,contract.UpdateBuyerCallFollowUpResponse,result);
});
router.get("/buyer-call-follow-ups",operate,async(_req,res)=>{
  send(res,contract.ListBuyerCallFollowUpsResponse,await store.listBuyerCallFollowUps());
});
router.post("/leads/:id/offers",research,async (req,res) => {
  const id=leadId(req),result=await offers.createOfferDraft(id,parse(contract.CreateOfferDraftBody,req.body),
    {id:String(res.locals.actor),role:String(res.locals.role)},
  );
  await propagateStaleTransactionDocuments(id);
  send(res,contract.CreateOfferDraftResponse,result,201);
});
router.get("/leads/:id/offers/:offerId/review",roles("OWNER","ANALYST","OPERATOR"),async(req,res)=>{
  const {id,offerId}=parse(contract.AuthorizeOfferParams,req.params);
  send(res,contract.GetOfferReviewResponse,await offers.getOfferReview(id,offerId));
});
router.post("/leads/:id/offers/:offerId/authorize",roles("OWNER"),async (req,res) => {
  const {id,offerId} = parse(contract.AuthorizeOfferParams,req.params);
  const result=await offers.authorizeOffer(id,offerId,parse(contract.AuthorizeOfferBody,req.body),{id:String(res.locals.actor),role:String(res.locals.role)});
  await propagateStaleTransactionDocuments(id);
  send(res,contract.AuthorizeOfferResponse,result);
});
router.post("/leads/:id/offers/:offerId/communicate",operate,async (req,res) => {
  const {id,offerId} = parse(contract.CommunicateOfferParams,req.params);
  const result=await offers.communicateOffer(id,offerId,parse(contract.CommunicateOfferBody,req.body),{id:String(res.locals.actor),role:String(res.locals.role)});
  await propagateStaleTransactionDocuments(id);
  send(res,contract.CommunicateOfferResponse,result);
});
router.post("/leads/:id/offers/:offerId/withdraw",research,async (req,res) => {
  const {id,offerId} = parse(contract.WithdrawOfferParams,req.params);
  const result=await offers.withdrawOffer(id,offerId,parse(contract.WithdrawOfferBody,req.body),{id:String(res.locals.actor),role:String(res.locals.role)});
  await propagateStaleTransactionDocuments(id);
  send(res,contract.WithdrawOfferResponse,result);
});
router.get("/call-next",async (_req,res) => send(res,contract.GetCallQueueResponse,await store.callQueue()));
router.get("/acquisition-queue",async (_req,res) => {
  send(res,contract.GetAcquisitionQueueResponse,await acquisitionQueue.acquisitionQueue(String(res.locals.role)));
});
router.post("/leads/:id/acquisition-queue-selection",roles("OWNER","OPERATOR","ANALYST"),async (req,res) => {
  const body = parse(contract.RecordAcquisitionQueueSelectionBody,req.body);
  send(res,contract.RecordAcquisitionQueueSelectionResponse,await acquisitionQueue.recordQueueSelection(
    leadId(req),body.version,String(res.locals.actor),String(res.locals.role),
  ));
});
router.post("/leads/:id/call-start",operate,async (req,res) => {
  const body = parse(contract.StartCallSessionBody,req.body);
  send(res,contract.StartCallSessionResponse,await acquisitionQueue.startCallSession(
    leadId(req),body.version,String(res.locals.actor),String(res.locals.role),
  ));
});
router.get("/assumptions",async (_req,res) => send(res,contract.GetAssumptionsResponse,await store.getAssumptions()));
router.put("/assumptions",roles("OWNER"),async (req,res) => {
  send(res,contract.UpdateAssumptionsResponse,await store.saveAssumptions(parse(contract.UpdateAssumptionsBody,req.body),String(res.locals.actor)));
});
router.get("/audit",roles("OWNER"),async (_req,res) => send(res,contract.ListAuditResponse,await store.listAudit()));

export default router;
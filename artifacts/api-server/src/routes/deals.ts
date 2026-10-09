import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import * as contract from "@workspace/api-zod";
import { DomainError } from "@workspace/deal-domain";
import { authenticated, membership, roles } from "../middlewares/access";
import * as store from "../services/deal-store";
import * as access from "../services/access";
import * as offers from "../services/offer-store";
import { commandCenter } from "../services/command-center";
import { intakePropertyEvidence } from "../services/evidence-intake";
import * as sellerContacts from "../services/seller-contact-store";
import * as sellerContactEnrichment from "../services/seller-contact-enrichment";
import * as acquisitionQueue from "../services/acquisition-queue-store";
import * as sellerPlaybooks from "../services/seller-playbook-store";

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
router.post("/leads/:id/evidence-intake",research,async(req,res)=>{
  send(res,contract.IntakePropertyEvidenceResponse,await intakePropertyEvidence(leadId(req),parse(contract.IntakePropertyEvidenceBody,req.body),
    {id:String(res.locals.actor),role:String(res.locals.role)}));
});
router.get("/command-center",async (_req,res) => {
  send(res,contract.GetCommandCenterResponse,await commandCenter(String(res.locals.role)));
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
  send(res,contract.RecordSellerContactObservationResponse,await sellerContacts.recordSellerContactObservation(
    leadId(req),parse(contract.RecordSellerContactObservationBody,req.body),
    {id:String(res.locals.actor),role:String(res.locals.role)},
  ));
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
  send(res,contract.UpdateLeadResponse,await store.updateLead(leadId(req),parse(contract.UpdateLeadBody,req.body),String(res.locals.actor)));
});
router.post("/leads/:id/intelligence",research,async (req,res) => {
  send(res,contract.AddIntelligenceResponse,await store.addIntelligence(leadId(req),parse(contract.AddIntelligenceBody,req.body),String(res.locals.actor)),201);
});
router.put("/leads/:id/underwriting",research,async (req,res) => {
  send(res,contract.SaveUnderwritingResponse,await store.saveUnderwriting(leadId(req),parse(contract.SaveUnderwritingBody,req.body),String(res.locals.actor)));
});
router.post("/leads/:id/transition",roles("OWNER","ANALYST","OPERATOR"),async (req,res) => {
  const input = parse(contract.TransitionLeadBody,req.body);
  send(res,contract.TransitionLeadResponse,await store.transitionLeadForActor(leadId(req),input,{id:String(res.locals.actor),role:String(res.locals.role)}));
});
router.post("/leads/:id/calls",operate,async (req,res) => {
  send(res,contract.RecordCallResponse,await store.recordCall(leadId(req),parse(contract.RecordCallBody,req.body),String(res.locals.actor)),201);
});
router.post("/leads/:id/offers",research,async (req,res) => {
  send(res,contract.CreateOfferDraftResponse,await offers.createOfferDraft(
    leadId(req),parse(contract.CreateOfferDraftBody,req.body),
    {id:String(res.locals.actor),role:String(res.locals.role)},
  ),201);
});
router.post("/leads/:id/offers/:offerId/authorize",roles("OWNER"),async (req,res) => {
  const {id,offerId} = parse(contract.AuthorizeOfferParams,req.params);
  send(res,contract.AuthorizeOfferResponse,await offers.authorizeOffer(id,offerId,parse(contract.AuthorizeOfferBody,req.body),{id:String(res.locals.actor),role:String(res.locals.role)}));
});
router.post("/leads/:id/offers/:offerId/communicate",operate,async (req,res) => {
  const {id,offerId} = parse(contract.CommunicateOfferParams,req.params);
  send(res,contract.CommunicateOfferResponse,await offers.communicateOffer(id,offerId,parse(contract.CommunicateOfferBody,req.body),{id:String(res.locals.actor),role:String(res.locals.role)}));
});
router.post("/leads/:id/offers/:offerId/withdraw",research,async (req,res) => {
  const {id,offerId} = parse(contract.WithdrawOfferParams,req.params);
  send(res,contract.WithdrawOfferResponse,await offers.withdrawOffer(id,offerId,parse(contract.WithdrawOfferBody,req.body),{id:String(res.locals.actor),role:String(res.locals.role)}));
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
router.get("/audit",async (_req,res) => send(res,contract.ListAuditResponse,await store.listAudit()));

export default router;
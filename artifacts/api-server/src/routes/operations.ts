import { Router, type IRouter } from "express";
import { z } from "zod";
import * as schemas from "@workspace/api-zod";
import { DomainError, WORKER_CAPABILITIES, type OfferActor } from "@workspace/deal-domain";
import * as poolOperations from "../services/buyer-pool";
import { authenticated, membership, roles } from "../middlewares/access";
import * as buyers from "../services/buyer-store";
import { allBuyerRecords, getBuyerRecord } from "../services/operations-records";
import { dealOperations, refreshMatches } from "../services/matching-store";
import * as transactions from "../services/transaction-store";
import { getTransactionDocumentReadiness } from "../services/transaction-document-registry";
import { recordTransactionException } from "../services/transaction-exceptions";
import * as workers from "../services/workers";
import { listHandoffs, recordHandoffEvent } from "../services/handoffs";

const router: IRouter = Router();
router.use(authenticated,membership);
router.get("/transaction-documents/readiness",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {leadId} = parse(z.object({leadId:z.string().uuid().optional()}),req.query);
  res.json(schemas.GetTransactionDocumentReadinessResponse.parse(await getTransactionDocumentReadiness(actor(res),leadId)));
});
export const actor = (res: {locals:Record<string,unknown>}): OfferActor => ({id:String(res.locals.actor),role:String(res.locals.role)});
export function parse<T extends z.ZodType>(schema: T,value: unknown): z.infer<T> {
  const clean = (v: unknown): unknown => typeof v==="string"?v.trim():Array.isArray(v)?v.map(clean):
    v && typeof v==="object"?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clean(x)])):v;
  const parsed = schema.safeParse(clean(value));
  if (!parsed.success) throw new DomainError(parsed.error.issues.map(e=>`${e.path.join(".")}: ${e.message}`).join("; "),400);
  return parsed.data;
}
router.get("/buyers",async (_req,res)=>{res.json(schemas.ListBuyersResponse.parse(await allBuyerRecords()));});
router.post("/buyers/discovered",roles("OWNER","ANALYST"),async(req,res)=>{
  res.status(201).json(schemas.DiscoverBuyerResponse.parse(await poolOperations.discoverBuyer(parse(schemas.DiscoverBuyerBody,req.body),actor(res))));
});
router.get("/worker-capabilities",(_req,res)=>res.json(schemas.GetWorkerCapabilitiesResponse.parse(WORKER_CAPABILITIES)));
router.post("/buyers",roles("OWNER","ANALYST"),async(req,res)=>{
  res.status(201).json(schemas.CreateBuyerResponse.parse(await buyers.createBuyer(parse(schemas.CreateBuyerBody,req.body),actor(res))));
});
router.get("/buyers/:id",async(req,res)=>{
  const {id} = parse(schemas.GetBuyerParams,req.params);
  res.json(schemas.GetBuyerResponse.parse(await getBuyerRecord(id)));
});
router.patch("/buyers/:id",roles("OWNER","ANALYST"),async(req,res)=>{
  const {id} = parse(schemas.UpdateBuyerParams,req.params);
  res.json(schemas.UpdateBuyerResponse.parse(await buyers.updateBuyer(id,parse(schemas.UpdateBuyerBody,req.body),actor(res))));
});
router.post("/buyers/:id/verification",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.VerifyBuyerParams,req.params);
  res.json(schemas.VerifyBuyerResponse.parse(await buyers.verifyBuyer(id,parse(schemas.VerifyBuyerBody,req.body),actor(res))));
});
router.post("/buyers/:id/qualification",roles("OWNER","ANALYST"),async(req,res)=>{
  const {id} = parse(schemas.RequestBuyerQualificationParams,req.params);
  res.json(schemas.RequestBuyerQualificationResponse.parse(await poolOperations.requestBuyerQualification(id,
    parse(schemas.RequestBuyerQualificationBody,req.body),actor(res))));
});
router.get("/deals/:id/operations",async(req,res)=>{
  const {id} = parse(schemas.GetDealOperationsParams,req.params);
  res.json(schemas.GetDealOperationsResponse.parse(await dealOperations(id)));
});
router.post("/deals/:id/matches",roles("OWNER","ANALYST","OPERATOR"),async(req,res)=>{
  const {id} = parse(schemas.RefreshMatchesParams,req.params);
  res.json(schemas.RefreshMatchesResponse.parse(await refreshMatches(id)));
});
router.patch("/deals/:id/matches/:buyerId",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {id,buyerId} = parse(schemas.RecordBuyerResponseParams,req.params);
  res.json(schemas.RecordBuyerResponseResponse.parse(await transactions.recordBuyerResponse(id,buyerId,parse(schemas.RecordBuyerResponseBody,req.body),actor(res))));
});
router.post("/deals/:id/destinations/:buyerId/activity",roles("OWNER","ANALYST","OPERATOR"),async(req,res)=>{
  const {id,buyerId} = parse(schemas.RecordDestinationActivityParams,req.params);
  res.json(schemas.RecordDestinationActivityResponse.parse(await transactions.recordDestinationActivity(id,buyerId,
    parse(schemas.RecordDestinationActivityBody,req.body),actor(res))));
});
router.post("/deals/:id/contract",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {id} = parse(schemas.CreateContractParams,req.params);
  res.status(201).json(schemas.CreateContractResponse.parse(await transactions.createContract(id,parse(schemas.CreateContractBody,req.body),actor(res))));
});
router.post("/deals/:id/contract/documents",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {id} = parse(schemas.PreparePurchaseReviewDocumentParams,req.params);
  const result = await transactions.preparePurchaseReviewDocument(
    id,parse(schemas.PreparePurchaseReviewDocumentBody,req.body),actor(res),
  );
  res.json(schemas.PreparePurchaseReviewDocumentResponse.parse(result));
});
router.patch("/deals/:id/contract/documents/:documentId",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {id,documentId} = parse(schemas.TransitionTransactionDocumentParams,req.params);
  const result = await transactions.transitionTransactionDocument(
    id,documentId,parse(schemas.TransitionTransactionDocumentBody,req.body),actor(res),
  );
  res.json(schemas.TransitionTransactionDocumentResponse.parse(result));
});
router.get("/deals/:id/contract/documents/:documentId/file",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {id,documentId} = parse(schemas.DownloadPurchaseReviewDocumentParams,req.params);
  const result = await transactions.downloadPurchaseReviewDocument(id,documentId,actor(res));
  res.set({
    "Content-Type":"application/pdf",
    "Content-Disposition":`attachment; filename="${result.fileName}"`,
    "Cache-Control":"no-store",
    "Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff",
  }).send(result.bytes);
});
router.post("/deals/:id/contract/exception",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordTransactionExceptionParams,req.params);
  res.json(schemas.RecordTransactionExceptionResponse.parse(await recordTransactionException(id,parse(schemas.RecordTransactionExceptionBody,req.body),actor(res))));
});
router.post("/deals/:id/contract/execution",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.ExecuteContractParams,req.params);
  res.json(schemas.ExecuteContractResponse.parse(await transactions.executeContract(id,parse(schemas.ExecuteContractBody,req.body),actor(res))));
});
router.post("/deals/:id/contract/milestones",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordClosingMilestoneParams,req.params);
  res.json(schemas.RecordClosingMilestoneResponse.parse(await transactions.recordClosingMilestone(id,parse(schemas.RecordClosingMilestoneBody,req.body),actor(res))));
});
router.post("/deals/:id/contract/outcome",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordDealOutcomeParams,req.params);
  res.json(schemas.RecordDealOutcomeResponse.parse(await transactions.recordDealOutcome(id,parse(schemas.RecordDealOutcomeBody,req.body),actor(res))));
});
router.get("/workers",async(_req,res)=>{res.json(schemas.ListWorkerJobsResponse.parse(await workers.listWorkerJobs()));});
router.get("/handoffs",async(_req,res)=>res.json(schemas.ListHandoffsResponse.parse(await listHandoffs())));
router.post("/handoffs/:id/events",roles("OWNER","ANALYST","OPERATOR"),async(req,res)=>{
  const {id} = parse(schemas.RecordHandoffEventParams,req.params);
  res.json(schemas.RecordHandoffEventResponse.parse(await recordHandoffEvent(id,parse(schemas.RecordHandoffEventBody,req.body),actor(res))));
});
router.post("/workers",roles("OWNER","ANALYST"),async(req,res)=>{
  res.status(201).json(schemas.SubmitWorkerJobResponse.parse(await workers.submitWorkerJob(parse(schemas.SubmitWorkerJobBody,req.body),actor(res))));
});
export default router;
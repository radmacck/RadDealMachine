import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import * as schemas from "@workspace/api-zod";
import { DomainError, WORKER_CAPABILITIES, type OfferActor } from "@workspace/deal-domain";
import * as poolOperations from "../services/buyer-pool";
import { authenticated, membership, roles, sensitiveWorkspaceData } from "../middlewares/access";
import * as buyers from "../services/buyer-store";
import * as buyerQualificationPortal from "../services/buyer-qualification-portal";
import { allBuyerRecords, buyerCapacityRecords, getBuyerRecord, getBuyerContactResearchRecord } from "../services/operations-records";
import { dealOperations, refreshMatches } from "../services/matching-store";
import * as transactions from "../services/transaction-store";
import * as outcomes from "../services/outcome-learning-store";
import { getTransactionDocumentReadiness, recordTransactionTemplateReview } from "../services/transaction-document-registry";
import { getTransactionReadinessReport } from "../services/transaction-readiness";
import { recordTransactionException } from "../services/transaction-exceptions";
import { createClauseReviewRequest, listClauseReviewRequests } from "../services/transaction-clause-requests";
import * as workers from "../services/workers";
import { listHandoffs, recordHandoffEvent } from "../services/handoffs";
import { getWorkspaceSetupStatus, saveWorkspaceSetup } from "../services/workspace-setup";

export const actor = (res: {locals:Record<string,unknown>}): OfferActor => ({id:String(res.locals.actor),role:String(res.locals.role)});
export function parse<T extends z.ZodType>(schema: T,value: unknown): z.infer<T> {
  const clean = (v: unknown): unknown => typeof v==="string"?v.trim():Array.isArray(v)?v.map(clean):
    v && typeof v==="object"?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clean(x)])):v;
  const parsed = schema.safeParse(clean(value));
  if (!parsed.success) throw new DomainError(parsed.error.issues.map(e=>`${e.path.join(".")}: ${e.message}`).join("; "),400);
  return parsed.data;
}
export function createTransactionTemplateReviewRouter(auth?:RequestHandler,member?:RequestHandler) {
  const reviewRouter=Router();
  if(auth&&member) reviewRouter.use(auth,member);
  reviewRouter.post("/transaction-document-templates/:id/review",roles("OWNER"),async(req,res)=>{
    const {id} = parse(z.object({id:z.string().uuid()}),req.params);
    res.json(await recordTransactionTemplateReview(id,req.body,actor(res)));
  });
  return reviewRouter;
}

export function createOperationsRouter(
  auth: RequestHandler = authenticated,
  member: RequestHandler = membership,
) {
const router: IRouter = Router();
router.use(auth,member);
router.use(sensitiveWorkspaceData);
router.get("/transaction-documents/readiness",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {leadId} = parse(z.object({leadId:z.string().uuid().optional()}),req.query);
  res.json(schemas.GetTransactionDocumentReadinessResponse.parse(await getTransactionDocumentReadiness(actor(res),leadId)));
});
router.use(createTransactionTemplateReviewRouter());
router.get("/deals/:id/contract/clause-review-requests",roles("OWNER","OPERATOR"),async(req,res)=>{
  const {id} = parse(schemas.GetClauseReviewRequestsParams,req.params);
  res.json(schemas.GetClauseReviewRequestsResponse.parse(await listClauseReviewRequests(id,actor(res))));
});
router.post("/deals/:id/contract/clause-review-requests",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.CreateClauseReviewRequestParams,req.params);
  res.status(201).json(schemas.CreateClauseReviewRequestResponse.parse(
    await createClauseReviewRequest(id,parse(schemas.CreateClauseReviewRequestBody,req.body),actor(res)),
  ));
});
router.get("/transaction-readiness",roles("OWNER","OPERATOR","ANALYST"),async(_req,res)=>{
  res.json(schemas.GetTransactionReadinessResponse.parse(await getTransactionReadinessReport()));
});
router.get("/workspace-setup",async(_req,res)=>{
  res.json(await getWorkspaceSetupStatus());
});
router.put("/workspace-setup",roles("OWNER"),async(req,res)=>{
  res.json(await saveWorkspaceSetup(req.body,String(res.locals.actor),String(res.locals.role)));
});
router.get("/outcome-learning",roles("OWNER","ANALYST"),async(_req,res)=>{
  res.json(schemas.GetOutcomeLearningResponse.parse(await outcomes.getOutcomeLearningReport(new Date(),String(res.locals.role)==="OWNER")));
});
router.post("/leads/:id/outcomes/actuals",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordOutcomeActualsParams,req.params);
  res.status(201).json(schemas.RecordOutcomeActualsResponse.parse(await outcomes.recordOutcomeActuals(
    id,parse(schemas.RecordOutcomeActualsBody,req.body),actor(res),
  )));
});
router.patch("/outcome-learning/recommendations/:id",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.ReviewOutcomeCalibrationParams,req.params);
  const body = parse(schemas.ReviewOutcomeCalibrationBody,req.body);
  res.json(schemas.ReviewOutcomeCalibrationResponse.parse(await outcomes.reviewOutcomeCalibration(
    id,body.decision,body.note,actor(res),
  )));
});
router.get("/buyers",roles("OWNER"),async (_req,res)=>{res.json(schemas.ListBuyersResponse.parse(await allBuyerRecords()));});
router.get("/buyers/capacity",roles("OWNER"),async (_req,res)=>{res.json(schemas.GetBuyerCapacityResponse.parse(await buyerCapacityRecords()));});
router.post("/buyers/discovered",roles("OWNER"),async(req,res)=>{
  res.status(201).json(schemas.DiscoverBuyerResponse.parse(await poolOperations.discoverBuyer(parse(schemas.DiscoverBuyerBody,req.body),actor(res))));
});
router.get("/worker-capabilities",(_req,res)=>res.json(schemas.GetWorkerCapabilitiesResponse.parse(WORKER_CAPABILITIES)));
router.post("/buyers",roles("OWNER"),async(req,res)=>{
  res.status(201).json(schemas.CreateBuyerResponse.parse(await buyers.createBuyer(parse(schemas.CreateBuyerBody,req.body),actor(res))));
});
router.get("/buyers/:id",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.GetBuyerParams,req.params);
  res.json(schemas.GetBuyerResponse.parse(await getBuyerRecord(id)));
});
router.get("/buyers/:id/contact-research",roles("OWNER"),async(req,res)=>{
  const {id}=parse(z.object({id:z.string().uuid()}),req.params);
  res.json(schemas.GetBuyerContactResearchResponse.parse(await getBuyerContactResearchRecord(id)));
});
router.patch("/buyers/:id",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.UpdateBuyerParams,req.params);
  res.json(schemas.UpdateBuyerResponse.parse(await buyers.updateBuyer(id,parse(schemas.UpdateBuyerBody,req.body),actor(res))));
});
router.post("/buyers/:id/verification",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.VerifyBuyerParams,req.params);
  res.json(schemas.VerifyBuyerResponse.parse(await buyers.verifyBuyer(id,parse(schemas.VerifyBuyerBody,req.body),actor(res))));
});
router.post("/buyers/:id/contact-permission",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordBuyerContactPermissionParams,req.params);
  res.json(schemas.RecordBuyerContactPermissionResponse.parse(await buyers.recordBuyerContactPermission(
    id,parse(schemas.RecordBuyerContactPermissionBody,req.body),actor(res),
  )));
});
router.post("/buyers/:id/qualification-portal",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.CreateBuyerQualificationPortalInviteParams,req.params);
  const result = await buyerQualificationPortal.createBuyerQualificationPortalInvite(
    id,parse(schemas.CreateBuyerQualificationPortalInviteBody,req.body),actor(res),
  );
  res.status(201).json(schemas.CreateBuyerQualificationPortalInviteResponse.parse(result));
});
router.post("/buyers/:id/qualification",roles("OWNER"),async(req,res)=>{
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
  const result=await transactions.createContract(id,parse(schemas.CreateContractBody,req.body),actor(res));
  await transactions.propagateStaleTransactionDocuments(id);
  res.status(201).json(schemas.CreateContractResponse.parse(result));
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
  const result=await recordTransactionException(id,parse(schemas.RecordTransactionExceptionBody,req.body),actor(res));
  await transactions.propagateStaleTransactionDocuments(id);
  res.json(schemas.RecordTransactionExceptionResponse.parse(result));
});
router.post("/deals/:id/contract/execution",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.ExecuteContractParams,req.params);
  res.json(schemas.ExecuteContractResponse.parse(await transactions.executeContract(id,parse(schemas.ExecuteContractBody,req.body),actor(res))));
});
router.post("/deals/:id/contract/milestones",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordClosingMilestoneParams,req.params);
  res.json(schemas.RecordClosingMilestoneResponse.parse(await transactions.recordClosingMilestone(id,parse(schemas.RecordClosingMilestoneBody,req.body),actor(res))));
});
router.post("/deals/:id/contract/deadline-schedule",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordTransactionDeadlineScheduleParams,req.params);
  res.json(schemas.RecordTransactionDeadlineScheduleResponse.parse(
    await transactions.recordTransactionDeadlineSchedule(id,parse(schemas.RecordTransactionDeadlineScheduleBody,req.body),actor(res)),
  ));
});
router.post("/deals/:id/contract/outcome",roles("OWNER"),async(req,res)=>{
  const {id} = parse(schemas.RecordDealOutcomeParams,req.params);
  res.json(schemas.RecordDealOutcomeResponse.parse(await transactions.recordDealOutcome(id,parse(schemas.RecordDealOutcomeBody,req.body),actor(res))));
});
router.get("/workers",roles("OWNER","ANALYST"),async(_req,res)=>{res.json(schemas.ListWorkerJobsResponse.parse(await workers.listWorkerJobs()));});
router.get("/handoffs",async(_req,res)=>res.json(schemas.ListHandoffsResponse.parse(await listHandoffs())));
router.post("/handoffs/:id/events",roles("OWNER","ANALYST","OPERATOR"),async(req,res)=>{
  const {id} = parse(schemas.RecordHandoffEventParams,req.params);
  res.json(schemas.RecordHandoffEventResponse.parse(await recordHandoffEvent(id,parse(schemas.RecordHandoffEventBody,req.body),actor(res))));
});
router.post("/workers",roles("OWNER","ANALYST"),async(req,res)=>{
  res.status(201).json(schemas.SubmitWorkerJobResponse.parse(await workers.submitWorkerJob(parse(schemas.SubmitWorkerJobBody,req.body),actor(res))));
});
return router;
}

export default createOperationsRouter();
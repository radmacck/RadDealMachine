import { Router, type IRouter } from "express";
import { z } from "zod";
import { DomainError } from "@workspace/deal-domain";
import * as contract from "@workspace/api-zod";
import { authenticated, membership, roles } from "../middlewares/access";
import * as sources from "../services/property-source-store";

const router: IRouter = Router();
router.use(authenticated,membership);
const research = roles("OWNER","ANALYST");
const actor = (res: {locals:Record<string,unknown>}) => ({id:String(res.locals.actor),role:String(res.locals.role)});
function parse<T extends z.ZodType>(schema:T,value:unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError(result.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; "),400);
  return result.data;
}
router.get("/property-sources",(_req,res)=>res.json(contract.ListPropertySourcesResponse.parse(sources.listPropertySources())));
router.get("/property-sources/phila-opa/records",async(req,res)=>{
  const p = parse(contract.SearchPublicPropertiesQueryParams,req.query);
  res.json(contract.SearchPublicPropertiesResponse.parse(await sources.searchPublicProperties(p.zip,p.lane??"properties")));
});
router.post("/property-sources/phila-opa/records/:recordId/import",research,async(req,res)=>{
  const p = parse(contract.ImportPublicPropertyParams,req.params);
  const input = parse(contract.ImportPublicPropertyBody,req.body);
  res.json(contract.ImportPublicPropertyResponse.parse(await sources.importPublicProperty(p.recordId,input.termsReviewed,actor(res))));
});
router.get("/leads/:id/source-research",async(req,res)=>{
  const {id} = parse(contract.GetSourceResearchParams,req.params);
  res.json(await sources.getSourceResearch(id));
});
router.post("/leads/:id/source-research",research,async(req,res)=>{
  const {id} = parse(contract.RefreshSourceResearchParams,req.params);
  const input = parse(contract.RefreshSourceResearchBody,req.body);
  res.json(await sources.refreshSourceResearch(id,input.version,input.termsReviewed,actor(res)));
});
router.post("/leads/:id/source-research/comps",research,async(req,res)=>{
  const {id} = parse(contract.AddSourceCompsParams,req.params);
  res.json(await sources.addSourceComps(id,parse(contract.AddSourceCompsBody,req.body),actor(res)));
});
export default router;
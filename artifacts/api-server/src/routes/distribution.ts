import { Router, type IRouter } from "express";
import * as schemas from "@workspace/api-zod";
import { authenticated, membership, roles } from "../middlewares/access";
import { actor, parse } from "./operations";
import * as distribution from "../services/distribution-store";

export const publicBuyerPortalRouter: IRouter = Router();
publicBuyerPortalRouter.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
publicBuyerPortalRouter.get("/portal/deal", async (req, res) => {
  const headers = parse(schemas.GetBuyerPortalDealHeader, { "X-Portal-Token": req.get("X-Portal-Token") });
  res.json(schemas.GetBuyerPortalDealResponse.parse(
    await distribution.getBuyerPortalDeal(headers["X-Portal-Token"]),
  ));
});
publicBuyerPortalRouter.post("/portal/deal/response", async (req, res) => {
  const headers = parse(schemas.RespondToBuyerPortalDealHeader, { "X-Portal-Token": req.get("X-Portal-Token") });
  const body = parse(schemas.RespondToBuyerPortalDealBody, req.body);
  res.json(schemas.RespondToBuyerPortalDealResponse.parse(
    await distribution.respondToBuyerPortalDeal(headers["X-Portal-Token"], body),
  ));
});

export const internalDistributionRouter: IRouter = Router();
internalDistributionRouter.use(authenticated, membership);
internalDistributionRouter.get("/deals/:id/distribution", async (req, res) => {
  const { id } = parse(schemas.GetDealDistributionParams, req.params);
  res.json(schemas.GetDealDistributionResponse.parse(await distribution.getDealDistribution(id)));
});
internalDistributionRouter.post("/deals/:id/distribution/authorize", roles("OWNER"), async (req, res) => {
  const { id } = parse(schemas.AuthorizeDealDistributionParams, req.params);
  const result = await distribution.authorizeDealDistribution(
    id, parse(schemas.AuthorizeDealDistributionBody, req.body), actor(res),
  );
  res.status(201).json(schemas.AuthorizeDealDistributionResponse.parse(result));
});
internalDistributionRouter.post("/distribution/:id/recipients", roles("OWNER", "OPERATOR"), async (req, res) => {
  const { id } = parse(schemas.ShareDistributionRecipientsParams, req.params);
  const result = await distribution.shareDistributionRecipients(
    id, parse(schemas.ShareDistributionRecipientsBody, req.body), actor(res),
  );
  res.json(schemas.ShareDistributionRecipientsResponse.parse(result));
});
internalDistributionRouter.post("/deals/:id/distribution/release-acceptance", roles("OWNER"), async (req, res) => {
  const { id } = parse(schemas.ReleaseDistributionAcceptanceParams, req.params);
  res.json(schemas.ReleaseDistributionAcceptanceResponse.parse(await distribution.releaseDistributionAcceptance(
    id, parse(schemas.ReleaseDistributionAcceptanceBody, req.body), actor(res),
  )));
});

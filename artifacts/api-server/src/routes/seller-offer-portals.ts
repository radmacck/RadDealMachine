import { Router, type IRouter } from "express";
import * as schemas from "@workspace/api-zod";
import { authenticated, membership, roles, sensitiveWorkspaceData } from "../middlewares/access";
import { actor, parse } from "./operations";
import * as portals from "../services/seller-offer-portals";

export const publicSellerOfferPortalRouter: IRouter = Router();
publicSellerOfferPortalRouter.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
publicSellerOfferPortalRouter.get("/portal/seller-offer", async (req, res) => {
  const headers = parse(schemas.GetSellerOfferPortalHeader, {
    "X-Seller-Offer-Token": req.get("X-Seller-Offer-Token"),
  });
  res.json(schemas.GetSellerOfferPortalResponse.parse(
    await portals.getSellerOfferPortal(headers["X-Seller-Offer-Token"]),
  ));
});
publicSellerOfferPortalRouter.post("/portal/seller-offer/response", async (req, res) => {
  const headers = parse(schemas.RespondToSellerOfferPortalHeader, {
    "X-Seller-Offer-Token": req.get("X-Seller-Offer-Token"),
  });
  const body = parse(schemas.RespondToSellerOfferPortalBody, req.body);
  res.json(schemas.RespondToSellerOfferPortalResponse.parse(
    await portals.respondToSellerOfferPortal(headers["X-Seller-Offer-Token"], body),
  ));
});

export const internalSellerOfferPortalRouter: IRouter = Router();
internalSellerOfferPortalRouter.use(authenticated, membership);
internalSellerOfferPortalRouter.use(sensitiveWorkspaceData);
internalSellerOfferPortalRouter.get("/leads/:id/offers/:offerId/seller-portal", async (req, res) => {
  const { id, offerId } = parse(schemas.GetSellerOfferPortalControlParams, req.params);
  res.json(schemas.GetSellerOfferPortalControlResponse.parse(
    await portals.getSellerOfferPortalControl(id, offerId),
  ));
});
internalSellerOfferPortalRouter.post(
  "/leads/:id/offers/:offerId/seller-portal",
  roles("OWNER"),
  async (req, res) => {
    const { id, offerId } = parse(schemas.IssueSellerOfferPortalParams, req.params);
    res.status(201).json(schemas.IssueSellerOfferPortalResponse.parse(
      await portals.issueSellerOfferPortal(id, offerId, parse(schemas.IssueSellerOfferPortalBody, req.body), actor(res)),
    ));
  },
);

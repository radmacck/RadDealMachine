import { Router, type IRouter } from "express";
import * as schemas from "@workspace/api-zod";
import { parse } from "./operations";
import * as portal from "../services/buyer-qualification-portal";

const router: IRouter = Router();
router.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
router.get("/portal/buyer-qualification", async (req, res) => {
  const headers = parse(schemas.GetBuyerQualificationPortalHeader, {
    "X-Qualification-Portal-Token": req.get("X-Qualification-Portal-Token"),
  });
  res.json(schemas.GetBuyerQualificationPortalResponse.parse(
    await portal.getBuyerQualificationPortal(headers["X-Qualification-Portal-Token"]),
  ));
});
router.post("/portal/buyer-qualification/response", async (req, res) => {
  const headers = parse(schemas.RespondToBuyerQualificationPortalHeader, {
    "X-Qualification-Portal-Token": req.get("X-Qualification-Portal-Token"),
  });
  const body = parse(schemas.RespondToBuyerQualificationPortalBody, req.body);
  res.json(schemas.RespondToBuyerQualificationPortalResponse.parse(
    await portal.respondToBuyerQualificationPortal(headers["X-Qualification-Portal-Token"], body),
  ));
});

export default router;

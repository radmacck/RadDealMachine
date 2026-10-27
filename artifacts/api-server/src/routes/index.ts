import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dealsRouter from "./deals";
import operationsRouter from "./operations";
import propertySourcesRouter from "./property-sources";
import { internalDistributionRouter, publicBuyerPortalRouter } from "./distribution";
import { internalSellerOfferPortalRouter, publicSellerOfferPortalRouter } from "./seller-offer-portals";
import publicBuyerQualificationPortalRouter from "./buyer-qualification-portal";
import finderPortalRouter from "./finder-portal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicBuyerPortalRouter);
router.use(publicBuyerQualificationPortalRouter);
router.use(publicSellerOfferPortalRouter);
router.use(finderPortalRouter);
router.use(dealsRouter);
router.use(operationsRouter);
router.use(internalDistributionRouter);
router.use(internalSellerOfferPortalRouter);
router.use(propertySourcesRouter);

export default router;

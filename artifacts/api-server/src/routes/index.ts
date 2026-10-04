import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dealsRouter from "./deals";
import operationsRouter from "./operations";
import propertySourcesRouter from "./property-sources";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dealsRouter);
router.use(operationsRouter);
router.use(propertySourcesRouter);

export default router;

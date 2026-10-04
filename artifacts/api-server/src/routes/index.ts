import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dealsRouter from "./deals";
import operationsRouter from "./operations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dealsRouter);
router.use(operationsRouter);

export default router;

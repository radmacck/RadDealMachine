import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dealsRouter from "./deals";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dealsRouter);

export default router;

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { DomainError } from "@workspace/deal-domain";
import type { ErrorRequestHandler } from "express";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "",process.env.CLERK_PUBLISHABLE_KEY),
})));
app.use((req,res,next) => {
  if (!["GET","HEAD","OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
    if (origin && new URL(origin).host !== host) {
      res.status(403).json({error:"Cross-origin mutations are not allowed."}); return;
    }
  }
  res.setHeader("Cache-Control","no-store");
  next();
});

app.use("/api", router);
export const apiErrorHandler: ErrorRequestHandler = (error,req,res,_next) => {
  if (error instanceof DomainError) { res.status(error.status).json({error:error.message}); return; }
  if (error?.type === "entity.parse.failed") { res.status(400).json({error:"Invalid JSON request."}); return; }
  req.log.error({err:error},"Request failed");
  res.status(500).json({error:"An unexpected server error occurred. No successful save was confirmed."});
};
app.use(apiErrorHandler);

export default app;

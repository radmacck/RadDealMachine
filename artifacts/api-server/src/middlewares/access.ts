import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { getAccess } from "../services/access";

export function createAuthenticatedMiddleware(resolveUserId: (req: Parameters<RequestHandler>[0]) => string | null): RequestHandler {
 return (req,res,next) => {
  const userId = resolveUserId(req);
  if (!userId) { res.status(401).json({error:"Sign in to access the internal operating system."}); return; }
  res.locals.actor = userId;
  next();
 };
}
export const authenticated: RequestHandler = createAuthenticatedMiddleware(req => getAuth(req).userId);
export const membership: RequestHandler = async (_req,res,next) => {
  const access = await getAccess(String(res.locals.actor));
  res.locals.role = access.role;
  if (access.role === "PENDING") { res.status(403).json({error:"Your account needs workspace owner approval."}); return; }
  next();
};
export function roles(...allowed: string[]): RequestHandler {
  return (_req,res,next) => {
    if (!allowed.includes(String(res.locals.role))) {
      res.status(403).json({error:"Your role is not permitted to perform this action."}); return;
    }
    next();
  };
}

/**
 * Private deal data contains contact details, exact addresses, financial evidence,
 * and transaction records. VIEWER remains read-only but cannot fetch these payloads.
 */
export const sensitiveWorkspaceData: RequestHandler = roles("OWNER","ANALYST","OPERATOR");
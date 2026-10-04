import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { getAccess } from "../services/access";

export const authenticated: RequestHandler = (req,res,next) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({error:"Sign in to access the internal operating system."}); return; }
  res.locals.actor = userId;
  next();
};
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
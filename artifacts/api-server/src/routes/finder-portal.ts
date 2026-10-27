import { Router, type IRouter, type RequestHandler } from "express";
import * as schemas from "@workspace/api-zod";
import { authenticated, membership, roles } from "../middlewares/access";
import * as submissions from "../services/deal-finder-submissions";

export function createFinderPortalRouter(
  auth: RequestHandler = authenticated,
  member: RequestHandler = membership,
) {
  const router: IRouter = Router();
  router.use(auth, member);
  router.get("/finder/submissions", roles("FINDER"), async (_req, res) => {
    res.json(schemas.ListOwnFinderSubmissionsResponse.parse(
      await submissions.listOwnFinderSubmissions(String(res.locals.actor)),
    ));
  });
  router.post("/finder/submissions", roles("FINDER"), async (req, res) => {
    res.status(201).json(schemas.CreateOwnFinderSubmissionResponse.parse(
      await submissions.createOwnFinderSubmission(req.body, String(res.locals.actor)),
    ));
  });
  return router;
}

export default createFinderPortalRouter();

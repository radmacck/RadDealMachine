import type { z } from "zod";
import { ListHandoffsResponse, RecordHandoffEventBody } from "@workspace/api-zod";
import { DomainError } from "./types";
import { evidenceUrl, pastInstant } from "./buyers";

export type HumanHandoff = z.infer<typeof ListHandoffsResponse>[number];
export type HandoffEventInput = z.infer<typeof RecordHandoffEventBody>;
export function applyHandoffEvent(h: HumanHandoff, p: HandoffEventInput, actorId: string, now: Date): HumanHandoff {
  p = RecordHandoffEventBody.parse(p);
  const previous = h.events.find(e=>e.eventKey===p.eventKey);
  if (previous) {
    const {recordedAt:_,recordedBy,...original} = previous;
    if (recordedBy!==actorId || JSON.stringify(RecordHandoffEventBody.parse(original))!==JSON.stringify(p))
      throw new DomainError("Event key belongs to another event or actor.",409);
    return h;
  }
  if (p.version!==h.version) throw new DomainError("Handoff changed. Reload before recording the actual event.",409);
  const lateReply = h.state==="CANCELLED"&&p.kind==="REPLIED"&&h.events.some(e=>e.kind==="CONTACTED")&&!h.events.some(e=>e.kind==="REPLIED");
  if (["CANCELLED","REPLIED"].includes(h.state)&&!lateReply) throw new DomainError("This handoff is terminal; history is retained.",409);
  evidenceUrl(p.evidenceUrl);
  const actual = pastInstant(p.occurredAt,now,"Actual outreach event");
  // A reply can be entered after a no-response/failure assessment, like a reply
  // entered after retirement. Do not rewrite the assessment or external time.
  const preceding = p.kind==="REPLIED"?h.events.filter(e=>e.kind==="CONTACTED"):h.events;
  if (actual<Date.parse(h.createdAt) || actual<Math.max(0,...preceding.map(e=>Date.parse(e.occurredAt))))
    throw new DomainError("Event cannot precede preparation or a previously recorded event.");
  let state = h.state, nextAction = h.nextAction, dueAt = h.dueAt;
  if (p.kind==="ROUTE_REVIEWED") {
    if (state!=="WAITING_CONTACT") throw new DomainError("Route review requires pending contact.",409);
    if (!p.channel||!p.routeValue?.trim()||!p.permissionEvidenceUrl)
      throw new DomainError("Route review requires channel, recipient route and contact-permission evidence.");
    evidenceUrl(p.permissionEvidenceUrl);
    nextAction = "Permitted route reviewed and retained. Perform human outreach on that route and record actual contact evidence; nothing has been sent.";
  } else if (p.kind==="CONTACTED") {
    if (state!=="WAITING_CONTACT") throw new DomainError("Record the outstanding reply/no-response before contacting again.",409);
    if (!p.channel||!p.routeValue||!p.permissionEvidenceUrl) throw new DomainError("Actual contact requires the channel, recipient route and reviewed contact-permission evidence.");
    evidenceUrl(p.permissionEvidenceUrl);
    const route = h.events.filter(e=>e.kind==="ROUTE_REVIEWED").at(-1);
    if (!route||route.channel!==p.channel||route.routeValue!==p.routeValue||route.permissionEvidenceUrl!==p.permissionEvidenceUrl)
      throw new DomainError("Review and persist the permitted recipient route before contacting; actual contact must match that review.",409);
    state = "WAITING_REPLY"; nextAction = "Await an actual reply. No buying intent, funding verification or offer acceptance is inferred.";
  } else if (p.kind==="REPLIED"||p.kind==="NO_RESPONSE") {
    const replyAfterRetry = p.kind==="REPLIED"&&state==="WAITING_CONTACT"&&h.events.some(e=>e.kind==="CONTACTED");
    if (state!=="WAITING_REPLY"&&!lateReply&&!replyAfterRetry) throw new DomainError("An actual recorded contact is required before a reply/no-response.",409);
    if (p.kind==="NO_RESPONSE"&&actual<Date.parse(h.dueAt)) throw new DomainError("The documented reply deadline has not elapsed.");
    state = lateReply?"CANCELLED":p.kind==="REPLIED"?"REPLIED":"WAITING_CONTACT";
    nextAction = p.kind==="REPLIED"
      ? "Review actual reply evidence through the existing qualification/call/offer workflow. This reply grants no approval or commercial authority."
      : "Reply deadline elapsed; review the permitted route and retry human outreach. No automatic resend.";
    if (lateReply) nextAction = "Late actual reply retained against stopped outreach. No reactivation, approval or commercial authority implied; review dated evidence separately.";
  } else if (p.kind==="FAILED") {
    state = "WAITING_CONTACT"; nextAction = "Review the documented failure and retry permitted human outreach. No successful contact inferred.";
  } else {
    state = "CANCELLED"; nextAction = "Handoff stopped; event history retained. No buyer rejection or legal cancellation inferred.";
  }
  if (["CONTACTED","NO_RESPONSE","FAILED"].includes(p.kind)) {
    const due = Date.parse(p.followUpAt??"");
    if (!Number.isFinite(due)||due<=now.getTime()) throw new DomainError("A future follow-up deadline is required.");
    dueAt = new Date(due).toISOString();
  }
  return {...h,version:h.version+1,state,dueAt,nextAction,updatedAt:now.toISOString(),
    events:[...h.events,{...p,recordedAt:now.toISOString(),recordedBy:actorId}]};
}
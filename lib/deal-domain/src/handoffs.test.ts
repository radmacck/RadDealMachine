import assert from "node:assert/strict";
import { test } from "node:test";
import { RecordHandoffEventBody } from "@workspace/api-zod";
import { applyHandoffEvent, type HumanHandoff } from "./handoffs";
import { sellerHandoffReplyEvidence } from "./handoff-evidence";
const now = new Date("2026-10-05T12:00:00Z");
const initial:HumanHandoff = {id:"fixture",version:1,subjectType:"BUYER",subjectId:"fixture-buyer",subjectVersion:1,
  contextKey:"fixture-task",recipient:"SYNTHETIC",preparedMessage:"Informational request only",state:"WAITING_CONTACT",
  dueAt:now.toISOString(),createdAt:"2026-10-05T10:00:00Z",updatedAt:"2026-10-05T10:00:00Z",nextAction:"Review route",events:[]};
const contact = () => RecordHandoffEventBody.parse({version:2,eventKey:"synthetic-contact",kind:"CONTACTED",
  occurredAt:"2026-10-05T11:00:00Z",evidenceUrl:"https://example.com/contact",note:"SYNTHETIC contact only",
  channel:"EMAIL",routeValue:"synthetic@example.com",permissionEvidenceUrl:"https://example.com/permission",
  followUpAt:"2026-10-06T12:00:00Z"});

const reviewed = () => applyHandoffEvent(initial,{...contact(),version:1,kind:"ROUTE_REVIEWED",eventKey:"synthetic-route",
  occurredAt:"2026-10-05T10:30:00Z"},"actor",now);
test("seller reply adapter retains dated indications without inferring financial facts",()=>{
  const seller = {...initial,subjectType:"SELLER" as const};
  const reply = {...contact(),kind:"REPLIED" as const,eventKey:"synthetic-reply",note:"SYNTHETIC actual response"};
  const evidence = sellerHandoffReplyEvidence(seller,reply,now);
  assert.equal(evidence.classification,"INDICATED"); assert.equal(evidence.sourceType,"SELLER");
  assert.equal(evidence.capturedAt,reply.occurredAt); assert.equal(evidence.sourceUrl,reply.evidenceUrl);
  assert.match(evidence.source,/fixture.*synthetic-reply/);
  assert.match(evidence.action??"",/reviewed underwriting and owner approval/);
  assert.throws(()=>sellerHandoffReplyEvidence(initial,reply,now),/seller handoff/);
  assert.throws(()=>sellerHandoffReplyEvidence(seller,contact(),now),/actual reply/);
});
test("preparation never implies sending; contact retains actual/recorded times and permission",()=>{
  const permittedRoute = reviewed();
  assert.equal(permittedRoute.state,"WAITING_CONTACT");
  assert.match(permittedRoute.nextAction,/nothing has been sent/);
  const h = applyHandoffEvent(permittedRoute,contact(),"actor",now);
  assert.equal(h.state,"WAITING_REPLY");
  assert.match(h.nextAction,/No buying intent/);
  assert.equal(h.events.at(-1)?.occurredAt,contact().occurredAt);
  assert.equal(h.events.at(-1)?.recordedAt,now.toISOString());
  assert.throws(()=>applyHandoffEvent(permittedRoute,{...contact(),eventKey:"synthetic-wrong-route",
    routeValue:"different@example.com"},"actor",now),/must match/);
});
test("reply entered after no-response retains actual and recorded times without restarting outreach",()=>{
  const contacted = applyHandoffEvent(reviewed(),contact(),"actor",now);
  const later = new Date("2026-10-07T12:00:00Z");
  const noResponse = applyHandoffEvent(contacted,{...contact(),version:contacted.version,eventKey:"synthetic-no-response",
    kind:"NO_RESPONSE",occurredAt:later.toISOString(),followUpAt:"2026-10-08T12:00:00Z"},"actor",later);
  const replyOccurredAt = "2026-10-05T11:30:00Z";
  const replied = applyHandoffEvent(noResponse,{...contact(),version:noResponse.version,eventKey:"synthetic-entered-late",
    kind:"REPLIED",occurredAt:replyOccurredAt},"actor",later);
  assert.equal(noResponse.state,"WAITING_CONTACT");
  assert.equal(replied.state,"REPLIED");
  assert.equal(replied.events.length,4);
  assert.equal(replied.events.at(-1)?.occurredAt,replyOccurredAt);
  assert.equal(replied.events.at(-1)?.recordedAt,later.toISOString());
  assert.throws(()=>applyHandoffEvent(replied,{...contact(),version:replied.version,eventKey:"synthetic-retry"},
    "actor",later),/terminal/);
});
test("contact needs permission/route/future follow-up and actual past event",()=>{
  for (const override of [{permissionEvidenceUrl:undefined},{routeValue:undefined},{followUpAt:undefined},
    {occurredAt:"2026-10-06T00:00:00Z"},{occurredAt:"2026-10-04T00:00:00Z"},
    {followUpAt:"2026-10-05T11:59:00Z"},{evidenceUrl:"javascript:bad"}])
    assert.throws(()=>applyHandoffEvent(reviewed(),{...contact(),...override},"actor",now));
});
test("no uncontacted reply and no early no-response; replies do not carry qualification/approval",()=>{
  const reply = {...contact(),kind:"REPLIED" as const,eventKey:"synthetic-reply",note:"SYNTHETIC actual response"};
  assert.throws(()=>applyHandoffEvent(reviewed(),reply,"actor",now),/actual recorded contact/);
  const h = applyHandoffEvent(reviewed(),contact(),"actor",now);

  const later = new Date("2026-10-07T12:00:00Z");
  assert.throws(()=>applyHandoffEvent(h,{...reply,version:3,kind:"NO_RESPONSE"},"actor",now),/deadline/);
  const result = applyHandoffEvent(h,{...reply,version:3,occurredAt:now.toISOString()},"actor",now);
  assert.equal(result.state,"REPLIED"); assert.equal(result.events.length,3);
  assert.match(result.nextAction,/no approval or commercial authority/);
  assert.throws(()=>applyHandoffEvent(result,{...contact(),version:4,eventKey:"another-contact"},"actor",now),/terminal/);
});
test("deadline/retry, failures and cancellations preserve event history without automatic resend",()=>{
  const h = applyHandoffEvent(reviewed(),contact(),"actor",now);

  const later = new Date("2026-10-07T12:00:00Z");
  const retry = applyHandoffEvent(h,{...contact(),version:h.version,eventKey:"synthetic-missed-response",kind:"NO_RESPONSE",
    occurredAt:later.toISOString(),followUpAt:"2026-10-08T12:00:00Z"},"actor",later);

  const replied = applyHandoffEvent(retry,{...contact(),version:retry.version,eventKey:"synthetic-entered-late",kind:"REPLIED",
    occurredAt:"2026-10-05T11:30:00Z"},"actor",later);
  assert.equal(retry.state,"WAITING_CONTACT"); assert.equal(retry.events.length,3);
  const cancelled = applyHandoffEvent(retry,{...contact(),version:4,eventKey:"synthetic-cancel",kind:"CANCELLED",
    occurredAt:later.toISOString()},"actor",later);
  assert.equal(cancelled.state,"CANCELLED"); assert.equal(cancelled.events.length,4);
  assert.match(cancelled.nextAction,/No buyer rejection or legal cancellation/);
  const failed = applyHandoffEvent(reviewed(),{...contact(),kind:"FAILED"},"actor",now);
  assert.equal(failed.state,"WAITING_CONTACT"); assert.match(failed.nextAction,/No successful contact/);
});
test("stale versions and out-of-order events are rejected",()=>{
  assert.throws(()=>applyHandoffEvent(initial,{...contact(),version:2},"actor",now),/changed/);
  const h = applyHandoffEvent(reviewed(),contact(),"actor",now);

  const later = new Date("2026-10-07T12:00:00Z");
  assert.throws(()=>applyHandoffEvent(h,{...contact(),version:3,eventKey:"synthetic-older",kind:"REPLIED",
    occurredAt:"2026-10-05T10:59:00Z"},"actor",now),/previously recorded event/);
});
test("late reply to stopped contacted outreach is retained without reactivation",()=>{
  const contacted = applyHandoffEvent(reviewed(),contact(),"actor",now);
  const stopped = applyHandoffEvent(contacted,{...contact(),version:3,eventKey:"synthetic-stopped",kind:"CANCELLED",
    occurredAt:now.toISOString()},"actor",now);
  const retained = applyHandoffEvent(stopped,{...contact(),version:4,eventKey:"synthetic-late-reply",kind:"REPLIED",
    occurredAt:"2026-10-05T11:30:00Z"},"actor",now);
  assert.equal(retained.state,"CANCELLED");
  assert.equal(retained.events.length,4);
  assert.equal(retained.events.at(-1)?.occurredAt,"2026-10-05T11:30:00Z");
  assert.equal(retained.events.at(-1)?.recordedAt,now.toISOString());
  assert.match(retained.nextAction,/Late actual reply retained/);
});

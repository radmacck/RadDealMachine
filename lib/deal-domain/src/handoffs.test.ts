import assert from "node:assert/strict";
import { test } from "node:test";
import { RecordHandoffEventBody } from "@workspace/api-zod";
import { applyHandoffEvent, type HumanHandoff } from "./handoffs";
import { sellerHandoffReplyEvidence } from "./handoff-evidence";
const now = new Date("2026-10-05T12:00:00Z");
const initial:HumanHandoff = {id:"fixture",version:1,subjectType:"BUYER",subjectId:"fixture-buyer",subjectVersion:1,
  contextKey:"fixture-task",recipient:"SYNTHETIC",preparedMessage:"Informational request only",state:"WAITING_CONTACT",
  dueAt:now.toISOString(),createdAt:"2026-10-05T10:00:00Z",updatedAt:"2026-10-05T10:00:00Z",nextAction:"Review route",events:[]};
const contact = () => RecordHandoffEventBody.parse({version:1,eventKey:"synthetic-contact",kind:"CONTACTED",
  occurredAt:"2026-10-05T11:00:00Z",evidenceUrl:"https://example.com/contact",note:"SYNTHETIC contact only",
  channel:"EMAIL",routeValue:"synthetic@example.com",permissionEvidenceUrl:"https://example.com/permission",
  followUpAt:"2026-10-06T12:00:00Z"});
test("seller reply adapter retains dated indications without inferring financial facts",()=>{
  const seller = {...initial,subjectType:"SELLER" as const};
  const reply = {...contact(),kind:"REPLIED" as const};
  const evidence = sellerHandoffReplyEvidence(seller,reply,now);
  assert.equal(evidence.classification,"INDICATED"); assert.equal(evidence.sourceType,"SELLER");
  assert.equal(evidence.capturedAt,reply.occurredAt); assert.equal(evidence.sourceUrl,reply.evidenceUrl);
  assert.match(evidence.source,/fixture.*synthetic-contact/);
  assert.match(evidence.action??"",/reviewed underwriting and owner approval/);
  assert.throws(()=>sellerHandoffReplyEvidence(initial,reply,now),/seller handoff/);
  assert.throws(()=>sellerHandoffReplyEvidence(seller,contact(),now),/actual reply/);
});
test("preparation never implies sending; contact retains actual/recorded times and permission",()=>{
  const h = applyHandoffEvent(initial,contact(),"actor",now);
  assert.equal(initial.state,"WAITING_CONTACT"); assert.equal(h.state,"WAITING_REPLY");
  assert.equal(h.events[0]?.occurredAt,"2026-10-05T11:00:00Z");
  assert.equal(h.events[0]?.recordedAt,now.toISOString());
  assert.equal(h.events[0]?.permissionEvidenceUrl,"https://example.com/permission");
});
test("retry is idempotent, another actor or changed payload cannot reuse event identity",()=>{
  const h = applyHandoffEvent(initial,contact(),"actor",now);
  assert.equal(applyHandoffEvent(h,contact(),"actor",now),h);
  assert.throws(()=>applyHandoffEvent(h,{...contact(),note:"Different"},"actor",now),/another event/);
  assert.throws(()=>applyHandoffEvent(h,contact(),"other",now),/another event/);
});
test("contact needs permission/route/future follow-up and actual past event",()=>{
  for (const override of [{permissionEvidenceUrl:undefined},{routeValue:undefined},{followUpAt:undefined},
    {occurredAt:"2026-10-06T00:00:00Z"},{occurredAt:"2026-10-04T00:00:00Z"},
    {followUpAt:"2026-10-05T11:59:00Z"},{evidenceUrl:"javascript:bad"}])
    assert.throws(()=>applyHandoffEvent(initial,{...contact(),...override},"actor",now));
});
test("no uncontacted reply and no early no-response; replies do not carry qualification/approval",()=>{
  const reply = {...contact(),kind:"REPLIED" as const,eventKey:"synthetic-reply",note:"SYNTHETIC actual response"};
  assert.throws(()=>applyHandoffEvent(initial,reply,"actor",now),/actual recorded contact/);
  const h = applyHandoffEvent(initial,contact(),"actor",now);
  assert.throws(()=>applyHandoffEvent(h,{...reply,version:2,kind:"NO_RESPONSE"},"actor",now),/deadline/);
  const result = applyHandoffEvent(h,{...reply,version:2,occurredAt:now.toISOString()},"actor",now);
  assert.equal(result.state,"REPLIED"); assert.equal(result.events.length,2);
  assert.match(result.nextAction,/no approval or commercial authority/);
  assert.throws(()=>applyHandoffEvent(result,{...contact(),version:3,eventKey:"another-contact"},"actor",now),/terminal/);
});
test("deadline/retry, failures and cancellations preserve event history without automatic resend",()=>{
  const h = applyHandoffEvent(initial,contact(),"actor",now), later = new Date("2026-10-07T12:00:00Z");
  const retry = applyHandoffEvent(h,{...contact(),version:2,eventKey:"synthetic-no-response",kind:"NO_RESPONSE",
    occurredAt:later.toISOString(),followUpAt:"2026-10-08T12:00:00Z"},"actor",later);
  assert.equal(retry.state,"WAITING_CONTACT"); assert.equal(retry.events.length,2);
  const cancelled = applyHandoffEvent(retry,{...contact(),version:3,eventKey:"synthetic-cancel",kind:"CANCELLED",
    occurredAt:later.toISOString()},"actor",later);
  assert.equal(cancelled.state,"CANCELLED"); assert.equal(cancelled.events.length,3);
  assert.match(cancelled.nextAction,/No buyer rejection or legal cancellation/);
  const failed = applyHandoffEvent(initial,{...contact(),kind:"FAILED"},"actor",now);
  assert.equal(failed.state,"WAITING_CONTACT"); assert.match(failed.nextAction,/No successful contact/);
});
test("stale versions and out-of-order events are rejected",()=>{
  assert.throws(()=>applyHandoffEvent(initial,{...contact(),version:2},"actor",now),/changed/);
  const h = applyHandoffEvent(initial,contact(),"actor",now);
  assert.throws(()=>applyHandoffEvent(h,{...contact(),version:2,eventKey:"synthetic-older",kind:"REPLIED",
    occurredAt:"2026-10-05T10:59:00Z"},"actor",now),/previously recorded event/);
});
test("late reply to stopped contacted outreach is retained without reactivation",()=>{
  const contacted = applyHandoffEvent(initial,contact(),"actor",now);
  const stopped = applyHandoffEvent(contacted,{...contact(),version:2,eventKey:"synthetic-stopped",kind:"CANCELLED",
    occurredAt:now.toISOString()},"actor",now);
  const retained = applyHandoffEvent(stopped,{...contact(),version:3,eventKey:"synthetic-late-reply",kind:"REPLIED",
    occurredAt:"2026-10-05T11:30:00Z"},"actor",now);
  assert.equal(retained.state,"CANCELLED"); assert.equal(retained.events.length,3);
  assert.match(retained.nextAction,/No reactivation/);
  assert.throws(()=>applyHandoffEvent({...initial,state:"CANCELLED"},{...contact(),kind:"REPLIED"},"actor",now),/terminal/);
});
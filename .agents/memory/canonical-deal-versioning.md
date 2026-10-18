---
name: Canonical deal versioning
description: The lead row is the aggregate deal-state authority; module versions are subordinate snapshots.
---

Treat the persisted lead `stage` and `version` as the canonical aggregate deal state. Module-specific offer, buyer, document, or transaction versions protect their own snapshots, but must not silently become competing deal-stage authorities. Consequential stage transitions should retain an append-only audit edge with prior/result version, actor, timestamp, reason, next action, and available evidence references.

**Why:** Cross-workflow state can be inspected through one aggregate revision without destructive consolidation or erasing module-specific history. Audit evidence must preserve why and from which revision a transition occurred.

**How to apply:** When adding a material workflow mutation, lock and check the lead revision, advance it transactionally, stale dependent snapshots as required, and record the version edge. Do not infer missing evidence references or rewrite prior events.

When one command emits multiple canonical stage transitions inside the same transaction, use a transaction-local version clock so every edge chains from the preceding edge, and persist the final clock value on the lead. Exact idempotent replays must not advance the clock.

**Why:** Underwriting saves and a connected first seller call can each record two stage changes atomically; reusing the original lead revision for both events creates duplicate version edges even when the final stage is correct.

**How to apply:** Pass one clock through every `move` in that command, use each event’s resulting version for its decision-work identity, and persist at least one revision for a meaningful mutation that emitted no stage edge.

All lead-creation paths for the same normalized market/city/state/ZIP/address identity must acquire the same transaction-scoped advisory lock before checking for an existing lead. Conflicts should be explicit; do not auto-merge records or backfill production duplicates without reviewed evidence.

**Why:** Locking only the discovery row does not serialize two distinct discoveries—or a manual create and a promotion—that represent the same property, so both transactions can pass a duplicate query and create separate canonical leads.

**How to apply:** Keep the lock key's normalization and scope identical across promotion and manual creation; test concurrent competing creates, exact replay, and existing-record conflict behavior in an isolated schema.

An owner-reviewed transaction deadline schedule is a contract revision: increment the contract row version as well as the schedule-specific version. Keep optimistic concurrency tokens out of the semantic request hash so exact idempotent retries do not create a second revision.

**Why:** Otherwise clients can keep using a contract version from before a schedule edit, and a retry's changed concurrency token can be mistaken for changed schedule content.

**How to apply:** For versioned subordinate edits, lock the contract row, check the request version for new commands, resolve exact idempotency-key replays against semantic content, and append schedule history only once.

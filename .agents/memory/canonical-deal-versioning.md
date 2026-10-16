---
name: Canonical deal versioning
description: The lead row is the aggregate deal-state authority; module versions are subordinate snapshots.
---

Treat the persisted lead `stage` and `version` as the canonical aggregate deal state. Module-specific offer, buyer, document, or transaction versions protect their own snapshots, but must not silently become competing deal-stage authorities. Consequential stage transitions should retain an append-only audit edge with prior/result version, actor, timestamp, reason, next action, and available evidence references.

**Why:** Cross-workflow state can be inspected through one aggregate revision without destructive consolidation or erasing module-specific history. Audit evidence must preserve why and from which revision a transition occurred.

**How to apply:** When adding a material workflow mutation, lock and check the lead revision, advance it transactionally, stale dependent snapshots as required, and record the version edge. Do not infer missing evidence references or rewrite prior events.

An owner-reviewed transaction deadline schedule is a contract revision: increment the contract row version as well as the schedule-specific version. Keep optimistic concurrency tokens out of the semantic request hash so exact idempotent retries do not create a second revision.

**Why:** Otherwise clients can keep using a contract version from before a schedule edit, and a retry's changed concurrency token can be mistaken for changed schedule content.

**How to apply:** For versioned subordinate edits, lock the contract row, check the request version for new commands, resolve exact idempotency-key replays against semantic content, and append schedule history only once.

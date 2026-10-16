---
name: Canonical deal versioning
description: The lead row is the aggregate deal-state authority; module versions are subordinate snapshots.
---

Treat the persisted lead `stage` and `version` as the canonical aggregate deal state. Module-specific offer, buyer, document, or transaction versions protect their own snapshots, but must not silently become competing deal-stage authorities. Consequential stage transitions should retain an append-only audit edge with prior/result version, actor, timestamp, reason, next action, and available evidence references.

**Why:** Cross-workflow state can be inspected through one aggregate revision without destructive consolidation or erasing module-specific history. Audit evidence must preserve why and from which revision a transition occurred.

**How to apply:** When adding a material workflow mutation, lock and check the lead revision, advance it transactionally, stale dependent snapshots as required, and record the version edge. Do not infer missing evidence references or rewrite prior events.

---
name: Durable execution identity
description: Why retry identity and recurring outreach context must survive storage normalization and routine maintenance
---

Compare persisted execution commands by semantic content, not JSON serialization key order.

**Why:** PostgreSQL JSONB normalizes object key order. A byte-order comparison rejected an identical retry after persistence, despite correct subject locking.

**How to apply:** Preserve actor, subject, capability and meaningful payload equality on retries; ignore object-key ordering, not differences in values or array semantics.

Do not define recurring informational outreach identity solely by a mutable subject row revision.

**Why:** Automatic matching legitimately advances seller row revisions without changing the outreach intent. Treating every revision as a new handoff repeatedly replaces pending work and loses the outstanding reply context.

**How to apply:** Scope handoffs to the relevant identity/route, due follow-up and business context. Keep exact version and authority gates for commercial actions. Actual replies are retained even when their original outreach has stopped.

Pending human reply review must survive maintenance-driven changes between initial qualification and re-verification.

**Why:** An isolated audit demonstrated that changing qualification kind could replace a pending review with another outreach request. Passing same-kind retry tests does not establish this boundary.

**How to apply:** Preserve the review obligation through evidence expiration and task-kind changes. Require explicit additional-evidence requests or dated owner review instead of treating periodic maintenance as permission to repeat preparation.
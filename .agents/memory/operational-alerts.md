---
name: Actionable alerts
description: Durable in-app alerts derived from canonical domain actions and exceptions.
---

Alerts are projections of canonical action, exception, or failed-job records; they must link back to that source and must not become a parallel source of domain truth. Dismissal and snooze are operator workflow state and require durable audit; external delivery is a separate permissioned action and must remain disabled unless explicitly configured and approved.

**Why:** Recomputing alerts from source records prevents duplicate noise and false progress, while separating in-app attention from email/SMS avoids accidental outreach.

**How to apply:** Deduplicate by stable source identity, reactivate after a snooze expires, resolve when the source action is no longer active, and keep external-send code out of alert generation.

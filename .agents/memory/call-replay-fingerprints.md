---
name: Call replay fingerprints
description: Preserve exact retry semantics for call records whose stored payload gains derived evidence fields.
---

For JSONB-backed call records that are enriched after initial persistence, replay checks must use a fingerprint of the original submitted request, not deep equality against the enriched payload.

**Why:** The persisted call later gains evidence metadata and reconciliation fields. Comparing that expanded record to a retried request makes a legitimate exact retry look like changed content.

**How to apply:** When changing call event storage or retry handling, calculate a canonical fingerprint from validated input before adding derived fields; retain it through record enrichment and compare actor plus fingerprint under the lead lock.

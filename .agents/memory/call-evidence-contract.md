---
name: Call evidence response shape
description: Keep seller-reported facts in linked call evidence when returning call history.
---

Call history should return the persisted note and evidence metadata; structured seller-reported facts are exposed as append-only intelligence records linked to that call rather than duplicated as a nested copy of the entire call-input object. Note extraction may persist compact structured capture alongside the source note, but every value must retain exact note anchors, confidence, seller-reported vs. inferred attribution, and edit state. Inferred values remain unverified and must not feed seller evidence or underwriting.

**Why:** Duplicating the full structured call-answer schema into lead/command-center responses caused generated TypeScript response types to exceed the compiler's serializable inferred-type limit. Linked evidence already preserves the source, classification, conflict state, and captured values. Separating inference from seller statements prevents extraction from silently becoming fact or changing deterministic economics.

**How to apply:** When updating the call history API or UI, prefer the call-linked seller evidence records for structured answers; do not add the full input object to widely nested response schemas without a deliberate compact response contract and a passing generated-type check. Validate every note offset against the submitted note; keep inferred fields separate until an operator explicitly reviews the source evidence.

Assemble a seller call packet from current verified property evidence, current underwriting, current contact readiness, unresolved questions, and persisted human call history. Keep estimated economics labeled as assumptions, source-link facts and contact routes, and preserve actor/time/outcome on prior notes.

**Why:** The packet needs enough context for a useful call without turning seller statements, model hypotheses, or estimates into facts or creating a parallel data authority.

**How to apply:** Reuse persisted lead, contact, and call records; do not duplicate call-answer payloads into broad aggregate response types. Outcome capture must remain version-checked, idempotent, auditable, and unable to change underwriting without explicit evidence review.

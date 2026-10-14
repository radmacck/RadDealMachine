---
name: Call evidence response shape
description: Keep seller-reported facts in linked call evidence when returning call history.
---

Call history should return the persisted note and evidence metadata; structured seller-reported facts are exposed as append-only intelligence records linked to that call rather than duplicated as a nested copy of the entire call-input object.

**Why:** Duplicating the full structured call-answer schema into lead/command-center responses caused generated TypeScript response types to exceed the compiler's serializable inferred-type limit. Linked evidence already preserves the source, classification, conflict state, and captured values.

**How to apply:** When updating the call history API or UI, prefer the call-linked seller evidence records for structured answers; do not add the full input object to widely nested response schemas without a deliberate compact response contract and a passing generated-type check.

---
name: Seller contact route reconciliation
description: Preserve identity conflicts when different recipient claims share a direct contact route.
---

Treat a normalized phone/email match as route equivalence, not proof that two recipient claims identify the same seller. Route readiness must stay blocked when recipient identities or roles conflict.

**Why:** Contact-route evidence from a promoted discovery can later reconcile with separately reviewed seller-contact evidence; synthetic fixtures that describe different recipients for the same number correctly trigger the same conflict gate as real evidence.

**How to apply:** Keep identity reconciliation strict in route import, promotion, and call-readiness tests. Make fixtures consistent when they intend to represent one seller; do not weaken conflict policy to make a test pass.

Keep contact-route provenance and permission history in a narrow, role-gated contact-research surface rather than broad buyer, deal, or command-center payloads. A route observation, verified identity, contact permission, and qualification are separate decisions.

**Why:** Broad aggregate responses are reused across many views; exposing private route and consent history there widens disclosure and can make generated response types impractically large.

**How to apply:** Add contact-specific read/write contracts for source, observed time, confidence, identity/conflict, freshness, and permission history. Keep external distribution redacted and require explicit review before readiness or outreach.

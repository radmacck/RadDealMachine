---
name: Offer authority boundaries
description: Financial authority tradeoff to preserve when extending negotiation, communications and contracts
---

An owner's acquisition ceiling is a constraint, not blanket permission for an operator to vary the approved commercial terms. Revised price, deposit, closing target or contingencies require another reviewed proposal.

**Why:** A numerical limit alone does not capture the owner's financial and operational risk review. Treating every price below that limit as approved could bypass review of materially different terms.

**How to apply:** When extending counteroffers or automated communications, keep calculation, explicit commercial approval and the actual communication event separate. Do not relax the approval boundary merely to make negotiation easier.

Seller contact research may update contact evidence and readiness, but it must not invalidate or alter acquisition economics, offer authority, transaction stage, or next action. Only the existing authorized workflows may change those states.

**Why:** Contact evidence is not a change to the deal's financial terms or a seller event; conflating it with underwriting can silently revoke or rewrite valid authority.

**How to apply:** Keep contact-route observations and review audit events separate from underwriting snapshots and offer/transaction transitions. A contact change may block future readiness, but must not rewrite a prior authorized offer or transaction history.

External contact-provider results are evidence intake only. Route them through the existing reconciliation pipeline as OBSERVED with contact-use permission and route verification left unreviewed; provider permission assertions and recipient claims do not establish seller identity, signing authority, or CALL READY.

**Why:** A provider's source and legal-basis metadata preserve provenance, but they cannot substitute for owner review or prove that a reported person can bind the property owner.

**How to apply:** Persist provider provenance and epistemic status alongside each observation, but keep human permission, route confirmation, identity, and transaction authority as separate checks.

Revoking or superseding internal authority does not undo a proposal already communicated to a seller.

**Why:** The system controls its own permissions, not a seller's memory or the legal effect of a prior human communication. A new approval must never rewrite that history.

**How to apply:** Preserve the prior terms, approval and actual communication evidence. Any seller notification or withdrawal must be a separate real event. Public-record ownership evidence is not title clearance or proof that every required signatory has consented.

An internal draft's review deadline controls how long that draft can be approved; after explicit approval, the separate approval expiry controls continuing authority. Material evidence or economics changes still invalidate the approved version.

**Why:** Treating the draft deadline as continuing authority expiry can invalidate a still-current owner approval prematurely, while ignoring the approval expiry could leave authority open indefinitely.

**How to apply:** Enforce draft expiry only before approval. After approval, evaluate the approved snapshot and its own expiry; preserve the exact approved version and audit trail.

A seller response closes that offer's response link; do not reopen the same communicated snapshot with a new token. Any further seller response cycle requires a newly reviewed, authorized and communicated offer.

**Why:** Reissuing the same terms after a recorded response can create contradictory seller intents against stale authority and weaken event idempotency.

**How to apply:** Keep response events append-only. If the seller proposes different terms, preserve that proposal as intent only, then draft, review, authorize and communicate new exact terms before issuing another link.

A one-time code sent through an owner-confirmed contact route proves control of that route only; it does not prove legal identity, ownership, or authority to bind every required seller.

**Why:** The portal needs a practical contact-verification step without silently converting possession of a phone or in-person code into legal identity or signing authority.

**How to apply:** Keep contact control, ownership/authority evidence, and actual signature evidence as separate checks. A portal acceptance remains seller intent, not an executed agreement.

An offer-readiness scorecard is informational and must not replace draft, legal-review, owner-approval, or communication gates. Missing or stale evidence must name both the gap and an actionable remedy; score changes never alter deterministic underwriting or grant authority.

**Why:** Aggregated scores can conceal a single blocking defect, and a high score is not permission to commit funds or communicate terms.

**How to apply:** Keep hard-stop criteria visible beside the score and leave existing exact-version approval and authorization checks unchanged.

Deal-economics scenarios are read-only what-if calculations. They must never mutate the authoritative underwriting snapshot or offer approvals; only explicit reviewed underwriting inputs create a new versioned snapshot, which invalidates dependent approvals.

**Why:** Scenario envelopes are exploratory assumptions, not new evidence or owner authorization. Persisting them as fact could silently change deal economics or keep stale approval alive.

**How to apply:** Keep scenario inputs local/explicitly labeled, expose formulas and provenance, and route reviewed changes through the existing version-checked underwriting save path with its approval invalidation behavior.

Negotiation versions must link to a communicated parent, the exact current underwriting snapshot, property/seller identity, conditions, expiry, and explicit seller-response evidence. A seller counter ends the parent's internal authority but does not rewrite or erase its communication.

**Why:** A recorded seller counter is not acceptance, and competing revisions must not inherit stale approval or overwrite the terms already communicated.

**How to apply:** Create a new immutable offer row with provenance and idempotency metadata. Permit only human-entered response evidence or a verified seller-portal counter event; require exact-version owner approval before any new communication.

Every offer review packet must carry the exact persisted underwriting snapshot and only the source records linked by its inputs. Include deterministic assumptions, confidence, formula output, downside case and unresolved evidence; unlinked model or conversation text must not alter the packet or economics.

**Why:** A snapshot ID without its reviewed inputs leaves an approver unable to verify what produced MAO, while aggregating unrelated live evidence can invalidate a draft for non-material changes.

**How to apply:** Resolve the snapshot by its persisted ID and lead, embed the immutable input/result plus linked source metadata in the hashed review packet, and list current readiness blockers separately. Material reviewed changes create a new snapshot and invalidate dependent offers; unlinked hypotheses never enter deterministic terms.
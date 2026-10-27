---
name: Destination activity boundaries
description: Product and data boundaries for deal-finder/guru submissions, referral terms, and fee outcomes.
---

Deal-finder/guru submissions, replies, exact terms, and referral-fee outcomes are a separate history from acquisition-buyer interest, commitment, and closing. A fee quoted on a destination profile is not evidence of receipt. Record actual event time separately from system recording time, along with the actor and evidence. Terms and fee outcomes require owner review. Keep the history append-only and allow evidenced fee outcomes to be recorded after a deal becomes terminal without changing buyer, closing, or proceeds state. Submission, reply, and terms events entered after termination must show that they actually happened before the terminal event.

Pre-contract finder opportunities belong in their own submission ledger, attributed to a finder destination record rather than an acquisition buyer or seller-evidence case. Submission authority to share data is not seller contact consent, seller identity, signing authority, or CALL_READY clearance. Keep fee terms separate from receipt status and require an evidence-linked owner action for acceptance, handoff, and fee outcomes.

**Why:** The user approved tracking destination activity separately so a referral relationship or fee cannot be mistaken for a buyer commitment or acquisition closing.

**How to apply:** Add destination events as their own provenance-backed ledger; preserve legacy buyer-workflow notes as explicitly unverified. Never infer an actual payment from a quoted profile fee or modify acquisition state when logging destination activity.

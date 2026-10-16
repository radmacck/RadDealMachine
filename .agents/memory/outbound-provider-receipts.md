---
name: Outbound provider receipts
description: Provider callback identity, delivery truth, terminal-state and retry invariants.
---

Correlate provider receipts using both provider identity and provider message ID. Make exact event-ID retries idempotent, reject conflicting reuse and cross-provider message-ID collisions, and do not let later callbacks rewrite a terminal delivery/failure. A retry is a new provider submission with a new message ID.

**Why:** A callback from a different provider or a late failure must not silently turn an unrelated or already-delivered message into a false delivery state.

**How to apply:** Enforce these rules in provider callback reducers and persisted webhook handlers; keep delivery separate from recipient interest, acceptance, or commitment.

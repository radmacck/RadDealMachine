---
name: Outbound provider receipts
description: Provider callback identity, delivery truth, terminal-state and retry invariants.
---

Correlate provider receipts using both provider identity and provider message ID. Make exact event-ID retries idempotent, reject conflicting reuse and cross-provider message-ID collisions, and do not let later callbacks rewrite a terminal delivery/failure. A retry is a new provider submission with a new message ID.

**Why:** A callback from a different provider or a late failure must not silently turn an unrelated or already-delivered message into a false delivery state.

**How to apply:** Enforce these rules in provider callback reducers and persisted webhook handlers; keep delivery separate from recipient interest, acceptance, or commitment.

Exact outbound approval must also bind a non-reversible recipient-route fingerprint, channel, immutable package version/hash, redaction level, package authorization identity, consent snapshot, exact content hash, approver, and approval time. At submission, recompute current consent and invalidate on any mismatch; route control alone is not recipient identity verification, and address disclosure remains forbidden through bearer-only recipient links.

**Why:** Recipient identity, consent, and disclosure can change independently of packet terms or message text, and a stale approval must not authorize a later external action.

**How to apply:** Persist these bindings with the outbound operation before provider submission. When no provider is configured, keep the state NOT SENT and expose the exact setup blocker rather than creating simulated acceptance or delivery.

Owner approval to issue a recipient-specific private package link is not approval of an external message. Bind link issuance to that buyer, immutable packet content/economics, redaction, current route and consent, and expiry; recheck before portal access. Keep it OWNER-only. Until a provider-backed outbound workflow persists exact text/channel approval and provider receipts, every delivery remains NOT SENT.

**Why:** A capability link grants access even when no email/SMS was sent, while copy/paste outside the app cannot provide trustworthy send or delivery evidence.

**How to apply:** Treat link creation as access authorization only. Do not infer message approval, provider submission, delivery, or buyer interest from link issuance, copying, or portal access.

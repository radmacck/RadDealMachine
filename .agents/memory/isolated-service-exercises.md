---
name: Isolated persistence exercises
description: Why service exercises must use faithful independent schemas across every pooled connection
---

Never test workspace claims, membership mutations, transaction outcomes or paid-provider fixtures against real workspace records. Use independent empty data with connection-wide isolation, including concurrent transactions.

**Why:** The user requires preservation of real authentication, ownership and domain records; a synthetic label alone does not isolate a test.

**How to apply:** Isolation must apply to every connection acquired from a pool, not just one connection's temporary settings. Reproduce relational constraints in the isolated database shape: PostgreSQL table cloning does not automatically reproduce foreign keys, so otherwise cleanup/cascade tests misrepresent production behavior.

For lifecycle revisions, test pre-execution staleness on a separate synthetic deal rather than mutating the primary happy-path transaction. Refresh the aggregate version after every append-only evidence event; CALL READY also requires a permitted, evidence-linked contact route. A prepared review PDF must remain unsigned, and new material evidence must make its old artifact unavailable for current use.

**Why:** Reusing the main deal for an invalidation test can destroy later transaction assertions; a document-preparation state is not execution evidence.

**How to apply:** When changing underwriting, offer, or packet snapshots, keep one isolated stale-artifact branch beside—not inside—the fully progressing transaction path, and assert both invalidation and the absence of signature/execution evidence.
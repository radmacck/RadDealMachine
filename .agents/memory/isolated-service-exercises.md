---
name: Isolated persistence exercises
description: Why service exercises must use faithful independent schemas across every pooled connection
---

Never test workspace claims, membership mutations, transaction outcomes or paid-provider fixtures against real workspace records. Use independent empty data with connection-wide isolation, including concurrent transactions.

**Why:** The user requires preservation of real authentication, ownership and domain records; a synthetic label alone does not isolate a test.

**How to apply:** Isolation must apply to every connection acquired from a pool, not just one connection's temporary settings. Reproduce relational constraints in the isolated database shape: PostgreSQL table cloning does not automatically reproduce foreign keys, so otherwise cleanup/cascade tests misrepresent production behavior.
---
name: Managed workflow port conflicts
description: Failed managed services with surviving prior listeners in this workspace
---

A managed workflow's failed status does not necessarily mean its previous server stopped. Old listeners can survive and prevent the next managed launch from binding.

**Why:** Both web and API workflows failed with address-in-use errors while their earlier artifact processes still held the expected ports. Repeated launches would reproduce the conflict.

**How to apply:** Inspect the current listener's process command and working directory. Stop only a verified stale process belonging to the affected artifact, then restart its existing managed workflow and check both workflow state and requests through the preview proxy. Do not change ports, create replacement workflows or terminate unrelated processes to hide the conflict.
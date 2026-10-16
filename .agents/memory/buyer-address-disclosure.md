---
name: Buyer address disclosure
description: Street-address disclosure policy for buyer packet previews and private buyer links.
---

Street addresses must remain redacted in externally accessible buyer portals when access relies only on a bearer link. An owner preference may control a future internal packet snapshot, but it does not establish recipient identity or permission to disclose the address through that link.

**Why:** A private bearer link can be forwarded and does not prove who is reading it. The existing buyer portal records capability access, not verified human identity.

**How to apply:** Keep external address disclosure fail-closed. Before permitting an unredacted buyer download or portal view, require an identity-verified access path and test that preview, stored packet, download, and access authorization use the same snapshot preference.

Evidence exports must be redacted by default, including free-text history that repeats an address or contact value. A stated recipient purpose is not proof of recipient identity or disclosure authorization.

**Why:** Exported audit packets can travel outside the authenticated workspace and may contain personal data embedded in otherwise ordinary event text.

**How to apply:** Require role, purpose, and explicit authorization for unredacted exports; keep immutable versions and hashes, and scrub sensitive values throughout nested structured and free-text fields.

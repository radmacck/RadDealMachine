---
name: Finder access boundary
description: Authorization boundary for authenticated deal-finder accounts
---

Do not weaken or broaden the global sensitive-workspace gate to admit finder accounts. Give approved finders a dedicated route surface, resolve their finder identity from the authenticated member record on every request, and return only their own submissions with a limited status projection.

**Why:** The user explicitly required that finder accounts not gain access to full seller data, buyer lists, internal notes, or operator-only deal fields.

**How to apply:** Keep finder submission and status endpoints isolated from internal operations routes. Never trust a client-supplied finder ID for ownership; preserve the authenticated submitter and append-only audit history.

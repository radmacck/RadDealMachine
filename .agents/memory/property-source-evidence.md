---
name: Public property-source evidence
description: Provenance and uncertainty rules for public parcel-level property research.
---

Join public property evidence only on exact stable parcel identifiers; never infer a match from nearby addresses. A source no-match describes that query result, not the absence or resolution of a condition. Keep source identity, retrieval time, record identity, epistemic classification, confidence, freshness, and material prior versions visible.

Persist each distinct source record even when multiple feeds resolve to one property; deduplicate the property workflow, not away its source provenance. Register external connectors only when access for the intended use is documented, honoring terms, robots rules, authentication, licenses, and rate limits. Never bypass restrictions; when permission is unclear, leave the source disconnected and report that limitation rather than listing it as an active feed.

Property-discovery results use bounded keyset pages ordered by persisted relevance, update time, then stable ID; market/status cursors and unmatched-source cursors are separate. Ordering is deterministic while records are unchanged, but pages are not a transactionally frozen snapshot across concurrent source refreshes.

Some ArcGIS endpoints can return HTTP-success JSON with an `error` object and no `features` array. Preserve that as an explicit provider/query failure; do not parse it as an empty successful observation batch or mark the source refresh successful.

**Why:** A generic schema error hid the upstream reason and made a live refresh look like a connector implementation defect.

**How to apply:** Inspect the provider's structured error payload before validating the normal response shape. Persist a bounded, sanitized source failure and leave refresh status partial or failed; never turn missing features into an empty success.

An exercise may persist useful observations from several feeds and still fail because one feed failed or the overall job requires complete coverage. **Why:** partial observations are not proof that the refresh completed, and an all-feeds assertion can fail even when ingestion itself behaved correctly. **How to apply:** Report per-feed observations separately from the overall exercise/job result; keep partial failures visible and do not call the source check a pass unless its stated completion criteria passed.

An exact-parcel sheriff-deed row is OBSERVED transfer activity only; it does not establish a current seller, foreclosure case, motivation, condition, or permission to contact. **Why:** recorded transfer data describes a past instrument, not present disposition or signing authority. **How to apply:** retain each dated deed observation and source identity, but give it no motivation weight without separate corroborating evidence.

**Why:** Public records can be stale, incomplete, or changed without establishing a property's present condition, occupancy, title, or seller motivation. A public page also does not by itself establish permission for automated collection. A strict event-time cutoff can also hide persisted source updates, so paged views must state their refresh behavior instead of implying an immutable snapshot.

**How to apply:** For parcel-source connectors, keep no-match, stale, and undated results distinct; use freshness to control qualification weight, preserve changed evidence history, and route uncertainty to a verification action. Keep one discovery per exact parcel identity while retaining each source's own record observation. For paged discovery, use stable keyset tie-breakers, page unmatched observations separately, and restart from the first page after refresh; never substitute a fixed first-page cap for access to the full pool. Before activating a new connector, verify and encode its permitted access method and source-specific limits.

Relevance signals must be freshness-checked at scoring and again at promotion; otherwise old captured evidence can keep a cached candidate eligible after it ages. Retain stale signals for audit, but do not award them points or let them support promotion.

**Why:** qualification previously scored signal strength and provenance classification without considering `capturedAt`, allowing stale evidence to cross a promotion threshold.

**How to apply:** Evaluate against an explicit current time, exclude invalid/future/expired signal captures, show a refresh blocker, and derive unpromoted discovery status from current eligible evidence instead of a cached status.

When promoting a discovery, retain a persisted observation's actual source key and the property's observed county; never hardcode a provider or jurisdiction.

**Why:** A hardcoded provider key breaks source lineage for other permitted feeds, and a hardcoded county can misroute jurisdiction-specific transaction review.

**How to apply:** Promote only from discoveries with persisted observations, choose a deterministic observation reference, and carry observed property geography into the canonical lead.

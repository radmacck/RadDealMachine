# Radical Deal OS requirement checklist

Updated October 5, 2026. This is an operating engine, not a CRM. Preserve tested foundations and verify one connected capability at a time.

**Overall: NOT GREEN.** Passing synthetic exercises does not prove a real deal is ready to close or that signed-in screens work in a browser.

## Acceptance levels

- **Implemented:** the code path exists; this alone is not evidence that it works.
- **Tested:** deterministic automated tests pass.
- **Exercised:** actual routes/services run against isolated PostgreSQL with relational constraints.
- **Real source:** an actual permitted provider was exercised, not a mocked response.
- **Unverified:** the capability still lacks required evidence at one or more acceptance levels.
- **Blocked:** an external workspace capability is unavailable; do not replace it with a weaker storage or safety boundary.
- **Signed-in UI:** the appropriate authenticated role completed the workflow in a browser.
- **Real deal:** an actual seller, reviewed authority, current approved buyer and external transaction evidence completed the flow.

## Operating requirements

| Requirement | Implementation and objective evidence | Remaining acceptance |
|---|---|---|
| Reusable, stand-alone engine with future Naelo boundary | Existing shared domain, public-source adapter, transactional services and leased workers reused. Orchestration/execution ports do not require Naelo. | Actual Naelo adapter is not connected. |
| Role-neutral customer-facing branding | Family/personal references removed from app copy; source scan passes. Owner/operator/analyst remain roles, not fixed identities. | Authenticated screen review. |
| Distinct discovered and approved/current buyer populations | Separate screens; approval derived from dated identity, funding where applicable, current intent, reviewed criteria and reviewer confidence. Bank verification alone does not approve legacy profiles. | Authenticated add → qualify → approve flow. |
| Real, permitted buyer discovery | Official Philadelphia corporate-owner feed → sourced OBSERVED prospect → persistent qualification task exercised against actual feed and isolated PostgreSQL: 20 observations. Atomic/repeated discovery is idempotent. No intent/contact/funds/criteria inferred. | Enable terms-reviewed discovery in the real workspace; coverage is Philadelphia, not nationwide. |
| Continuous discovery | Six-hour leased source jobs follow persisted latest manual opt-in. Opt-in, disable and concurrent claim behavior tested. | Website/post/group/form feeds require permitted adapters/connections. No restricted scraping or fabricated responses. |
| Evidenced current buying | Owner review records buying status, capture/review time, source, evidence links, confidence and criterion snapshot. Financial evidence is separately required for acquisition buyers. History is preserved and visible. | Actual buyer responses/documents and authenticated review. Reviewer confidence is not a probability guarantee. |
| Comprehensive maintainable criteria | States/counties/cities/ZIPs and exclusions; types/units; price and ARV bounds; beds/baths/size; repairs/rehab; strategy/funding; closing speed/concurrency; optional policy headroom/cap rate. Missing criteria stay unknown. Unchanged JSONB/set ordering does not invalidate evidence; substantive changes do. | Rental/development/cap-rate valuation adapters are not implemented. Current financial adapter remains conservative single-unit residential flip/wholesale; unsupported requirements block matching. |
| Stale-buyer re-verification | Evidence expiration creates one durable REVERIFY task; fresh approval does not trigger repetitive qualification. Waiting tasks are idempotent, visible and linked from command center. | Automated external outreach is not connected; drafts are WAITING_EXTERNAL, never “sent.” |
| Approved-only automatic matching | Current intent/criteria, geography/exclusions, units/size, budget, repairs, ARV, funding, concurrent commitments and closing deadline checked with reasons. Current contractual commitments reserve funds/slots. Unit and transaction exercises pass. | Actual current approved buyers and real eligible signed deals. |
| Deal-finder/guru destinations | Separately typed destinations, sourced quoted fee terms, qualified routing and real-interest recording. Destination interest cannot advance acquisition-buyer interest or satisfy buyer commitment/closing. SQL exercise verifies refusal. Quoted fees are not receipts. | Actual destination agreements and end-buyer qualification. |
| Real recurring workers | Persisted jobs, leases/heartbeats/recovery, five-minute matching/deadline/pool schedules and fifteen-second polling. Capability registry exposes available and pending connectors. | No automated seller/buyer messaging, signatures or funds transfers. |
| Sourced seller/property opportunity intake | Official parcel research/import/refresh and sale-candidate transfer tested previously against live source and isolated SQL. Assessment ≠ ARV; tax owner ≠ verified seller/title; sale candidate ≠ verified comp. | Broader permitted property and sold-comparable coverage, actual seller contact/authority/condition confirmation. |
| Guided seller conversation and financial authority | Existing seller/offer tests retained. Reviewed evidence, deterministic underwriting, exact owner-authorized terms, dated communication and next actions remain guarded. | Signed-in operator CALL NEXT flow; real seller negotiation. |
| Seller-facing authorized-offer response | Implemented owner-only, one-time capability links for exact communicated terms; raw tokens are hashed, the URL fragment is removed after tab-session storage, and pending response details/event keys survive same-tab reloads for idempotent retry. Responses are append-only; rotations and expiry are enforced. Isolated PostgreSQL exercise called the actual unauthenticated Express GET/POST routes and passed accept/reject/counter, exact snapshot, retry/conflict, rotation, expiry, unauthorized issuance, unchanged-authority, and no-contract checks. | Public no-token page is visually checked; signed-in owner controls and a real seller response remain unverified. A typed name is self-reported only; no identity verification, signature, contract, or message sending is implemented. |
| Offer → executed contract → interest → commitment → closing | Updated isolated transaction exercise passes through four external-evidence milestones, settlement reconciliation and immutable terminal history; destination safety added. | Real signatures/title/escrow/funds/settlement. No external legal or financial action is performed by the app. |
| Closing date changes and buyer withdrawal | Existing external commitment boundaries preserved; silent withdrawal is refused. | Safe evidenced amendment/replacement-buyer paths remain pending, not complete. |
| Authenticated usability and production readiness | Existing authorization tests pass; no auth bypass or first-owner test claim in real workspace. | Signed-in responsive UI verification and publishing/production verification. |
| Persistent real-estate document uploads | **Blocked:** App Storage provisioning failed because workspace credits are exhausted. No local-disk or database-byte fallback was added. | Revisit after App Storage is available; store file bytes in App Storage and only object paths plus queryable metadata in PostgreSQL. |
| Delivery window | October 4–18, 2026 at 10:45 AM; timezone unspecified. Week 2 real flow; Week 3 close-ready real deal. | These targets are not seller/buyer commitments or a guarantee of closing. |

## Current verification record

- 58 automated tests pass: domain 43, source adapter 5, access 7, bounded research 3.
- Full workspace TypeScript checks pass.
- Frontend production build passes; existing source-map/chunk-size warnings remain non-blocking. Frontend and API workflows are running.
- Seller-offer portal PostgreSQL exercise passes against an isolated cloned schema. It uses the actual public Express routes and synthetic data only; no real seller or external message was involved.
- Buyer SQL exercise covers unchanged criteria, approval, evidence history, expiry, idempotent re-verification, changed criteria and identity invalidation.
- Transaction SQL exercise covers actual-buyer and destination interest/commitment boundaries through settlement.
- Live source → isolated database exercise covers 20 actual public observations, source deduplication, concurrent leased execution and recurring opt-in/disable.
- No real workspace prospects or seller records were seeded by these exercises. No external communications, signatures or funds transfers occurred.
- Runtime health returns 200; anonymous buyer/worker/capability requests return 401. The `/buyers` screenshot renders the healthy neutral-branded sign-in landing page, **not** the signed-in buyer interface.
- The public `/seller-offer` route renders its no-token state; this does not verify signed-in owner controls or a real seller's response.

Do not mark an entire requirement GREEN while any required acceptance level remains unverified. Update this file as verified capabilities and actual system evidence change.
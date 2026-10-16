# Real-estate operating-system build checkpoint

**Checkpoint date:** 2026-10-15
**Current gate:** Block 27 is **PARTIAL**. Permitted source refresh and seller-contact research use persisted job/request intent and retry history; contact research now records an authorization snapshot, provider attempt/response history, idempotency, and explicit operation state. Email/text, package delivery, signature requests, and other provider sends remain unconfigured and are not sent. No live delivery provider is available. Block 20 readiness remains **NOT READY**; see `docs/real-estate-os-readiness-report.json`.
**Checkpoint rule:** On each accepted build turn, resume at the first item below that is not objectively verified. Queued tasks are not background execution; no work is considered active after its Agent turn ends.

## Product and implementation rules

Build the existing product as a reusable acquisition, seller-intelligence, deterministic-underwriting, buyer-demand, disposition, transaction, and closing operating system—not a generic CRM or volume scraper. Preserve existing code and data; reuse canonical services. Keep operator work focused on conversations, approvals, and exceptions.

Every slice must implement behavior, run automated tests and an isolated persisted exercise, perform relevant real-system verification, then mark GREEN only when its acceptance criteria are objectively proven. Keep source/time/freshness/confidence/permission/identity/provenance/audit. Maintain VERIFIED FACT, OBSERVED, INDICATED, and AI HYPOTHESIS as distinct classes; seller statements stay seller-reported. Do not invent facts, contacts, buyers, calls, signatures, funds, legal language, provider connections, or external actions. Use deterministic underwriting/matching. Keep protected communication, out-of-authority offers, and legal/contract actions behind human approval. Respect each source's access, terms, licensing, privacy, robots, and rate limits. Naelo/RDC are future adapters only.

## Ordered backlog

| Priority | Scope | State at checkpoint |
| --- | --- | --- |
| **P0** | Persisted decision-work lifecycle: legal READY/BLOCKED/IN_PROGRESS/COMPLETED/FAILED/EXPIRED transitions; concurrent claim/lease; bounded attempts/backoff; retryable vs terminal failure; idempotent completion; evidence/version checks before execution and completion; stale-work blocking/re-evaluation; audit events; authorization gates; worker integration; persisted exercise for contention, retry, failure, replay, stale evidence, expiry, and denied authorization. | **GREEN for lifecycle semantics.** Persisted isolated exercise passed: one concurrent winner; retry success; third-attempt terminal stop; duplicate completion produced no duplicate event; stale in-progress work blocked; stale pending retry expired; human-gated claim denied; explicit expiry and expired-lease recovery; synthetic worker dispatcher completed only a registered executor. 67 work events and 87 audit rows were recorded in the cloned exercise schema. No production executor is registered, so unsupported actions remain READY and no external action is claimed. |
| **P1** | Gap-aware intelligence loop: return known evidence, unknowns, conflicts/staleness, eligible/blocked actions, one deterministic next action, authorization need, and evidence/rule references; idempotently create work and reevaluate on material changes. | Re-exercised after P0 integration: 9 synthetic persisted scenarios passed; 15 work items and 1 worker evaluation persisted; all fixtures remained labeled synthetic. |
| **P2** | Property discovery: retain permitted Philadelphia OPA, L&I violations, unsafe buildings, vacancy, permits, and demolition feeds; pagination, dedupe, all observations, freshness, explainable relevance, and no automatic lead promotion; expand only to sources actually permitted and exercised. | **PARTIAL — accessible feeds exercised; not GREEN for broad-source coverage.** Added and exercised a sheriff-deed subfeed from the existing Philadelphia transfers dataset. Zillow/Redfin/FSBO, listing remarks, broader distress filings, parcel tax, and non-Philadelphia feeds remain explicitly unavailable. |
| **P3** | Seller contactability: replaceable provider states, provenance/identity/route/permission/freshness/conflict, idempotent bounded enrichment, safe manual evidence, and fail-closed CALL READY. | Manual case capture and candidate-route transfer verified; persisted command-center coverage shows 0 direct routes from permitted live feeds. No direct-contact provider or real seller route is proven. |
| **P4** | CALL NEXT and seller intelligence: ranked brief and evidence classes; immutable call notes with source/time/operator; reconciliation without overwrites; material changes invalidate stale economics; permitted listing descriptions become source-linked clues/questions. | Existing foundation; live authenticated workflow remains unverified. |
| **P5** | Underwriting: deterministic comps/ARV, condition-based repair ranges, costs, MAO/offer ranges, approved limits, assignment fee and buyer price, risk classification, explicit missing-input work, snapshot versioning and invalidation. | Deterministic foundation and synthetic exercise reported; live property economics remain unproven. |
| **P6** | Buyer demand: prospects remain unverified until current evidence; structured criteria, funding/capacity, source/confidence/last-verified/version, stale downgrade, and explainable matching. | **GREEN for persisted workflow semantics; no live approved/current buyer pool.** Real public-source discovery creates only unverified prospects; synthetic owner-reviewed evidence exercises approval, expiry, explainable matching/exclusion, and rejection of a mismatched lead/offer economics snapshot before packet persistence. Outreach remains NOT_SENT because no provider is connected. |
| **P7** | Distribution/commitment: identical immutable buyer-safe packet to selected current buyers; address redaction; delivery/view/interest tracking; first valid qualified commitment only after all gates; concurrency, expiry, replacement, release, and amendment history. | **PARTIAL.** Persisted synthetic distribution and first-valid-commitment gates pass. Valid buyer-link GETs now persist capability-access events; these do not establish reader identity or external delivery. Links are copied manually and no delivery provider is connected. |
| **P8** | Contracts/signing: jurisdiction-approved templates, private managed storage, replaceable signing provider, stale-snapshot protection, and truthful document states. | Provider/template/storage boundary exists; no approved template or signing provider proven. |
| **P9** | Funds/closing: EMD and funds evidence, deadlines, title/inspection/closing tasks, amendments, party changes, replacement/expiry, exceptions, closing proof, and time validation. | **PARTIAL.** Individual milestone schedules, stale-schedule protection, date exceptions, and event-time evidence are now persisted and synthetic-exercised. No real transaction exists in development; external signature, delivery, managed storage, and closing evidence remain unavailable/unverified. |
| **P10** | Command center: authenticated action-centered CALL NEXT / WHY / NEXT, ranked opportunities, blockers/evidence/economics/deadlines/matches/exceptions, complete paginated pools, and no repeated manual hunting/re-entry. | **PARTIAL.** API-backed UX, readiness boundaries, role gates, empty/error/stale states, and persisted service exercise verified. Authenticated owner browser acceptance remains unverified. |
| **P11** | Outcome learning: persist outcomes and predicted-vs-actual performance; calibrate only from sufficient real evidence with rule/confidence versions; exclude synthetic fixtures from live learning. | **PARTIAL — persisted mechanics exercised, live calibration unverified.** Canonical events project idempotently; owner actuals capture is snapshot-bound; synthetic records are excluded; insufficient evidence is persisted; a synthetic threshold-path preview remains non-deployable. No real outcome exists in the development workspace, so no real threshold-met recommendation or real review/reversal was exercised. |
| **P12** | End-to-end live proof: permitted discovery through contact, seller conversation, refreshed underwriting, authorized offer, current buyer, confirmed distribution/commitment, approved documents/signature, funds/deadlines/closing, and outcome. Label every synthetic step; never count one as live proof. | Incomplete; no GREEN claim until evidenced end to end. |

## Resume rule

Work one vertical slice at a time, beginning at the earliest non-verified priority. If a required provider or source is unavailable, persist and report that boundary truthfully while continuing only with independent work that can be proven.

## Latest verification checkpoint

- Outcome-learning development schema push applied successfully; no production database was changed.
- `pnpm --filter @workspace/api-spec run codegen` and workspace library typecheck passed; API and web typechecks passed.
- Outcome-learning automated tests passed **2/2**.
- Persisted isolated exercise passed with explicitly synthetic data: 4 source-derived outcome rows; repeat reconciliation inserted 0 rows; call occurred-at and recorded-at remained distinct; actual ARV delta was **−$5,000** and actual repair delta **$0**; concurrent/replayed actuals shared one record; stale analysis snapshot was rejected; one canonical decision reevaluation job was created; synthetic close retained a **+1-day** time-to-close delta; terminal reevaluation left **0** runnable work items.
- The persisted five-sample threshold-path preview was marked `TEST_ONLY_NOT_DEPLOYABLE`; synthetic outcomes remained excluded from report sample counts and live rule versions. Owner-only actual capture rejected a non-owner; synthetic preview approval was rejected.
- A read against the real development database passed the response-schema parse and reported **0 real / 0 synthetic outcome events**, **0 eligible ARV / 0 eligible repair samples**, `INSUFFICIENT_EVIDENCE`, and `liveRulesChanged=false`. No real outcome was seeded.
- API build passed. Web build passed with the artifact's required `PORT=20639 BASE_PATH=/`; Vite emitted source-map lookup and >500 kB chunk warnings, but exited successfully.
- The API and web workflows are configured/running; this checkpoint does not claim authenticated browser verification.
- Remaining P0 limitation: the production executor registry is intentionally empty until an authorized supported executor is configured. Calls, offers, legal actions, and unsupported research remain unexecuted.

## P2 property-source expansion verification

**Exercise date:** 2026-10-08
**Result:** persisted property-source exercise PASSED in an isolated schema. It queried real Philadelphia public records; synthetic qualification/pagination fixtures stayed labeled synthetic. The isolated schema was not the development or production database.

The replaceable source registry now exposes `phila-sheriff-deed-records` as a distinct property-observation feed over the existing public City real-estate-transfers dataset. It uses exact nine-digit OPA account joins, a 180-day event window, stable keyset pages of 40, and a 1,000-record per-run bound that fails explicitly if exceeded. Each deed remains `OBSERVED`, retains event/source identities and provenance, produces no motivation signal, and cannot directly promote a lead. This is an additional subfeed from an existing publisher, not a new independent listing provider.

| Property feed ID | Exercise state | Persisted observation rows | Linked / unmatched | Source event records |
| --- | --- | ---: | ---: | ---: |
| `phila-opa` | LIVE+EXERCISED | 611 | 611 / 0 | 611 |
| `phila-li-violations` | LIVE+EXERCISED | 96 | 87 / 9 | 170 |
| `phila-li-unsafe` | LIVE+EXERCISED | 87 | 87 / 0 | 6 |
| `phila-vacancy-indicators` | LIVE+EXERCISED | 87 | 87 / 0 | 13 |
| `phila-li-building-permits` | LIVE+EXERCISED | 90 | 87 / 3 | 111 |
| `phila-li-demolitions` | LIVE+EXERCISED | 104 | 87 / 17 | 40 |
| `phila-sheriff-deed-records` | LIVE+EXERCISED | 751 | 611 / 140 | 672 |

The sheriff-deed traversal itself returned 524 exact-parcel matches over 17 pages and 672 source records. The 611 linked observation rows include explicit per-discovery results; the 140 unlinked deed observations remain visible rather than being discarded. Across the exercise there were 611 unique real discoveries, 169 unmatched observations across feeds, and **0 active leads created from raw discovery**. No direct contact route was available: 0 POSTAL, PHONE, EMAIL, WEB, or OTHER routes were persisted in the live-source contact count.

Additional exercise assertions: the 611 real discovery records paginate as 25 pages (25 per page); 169 unmatched observations paginate as 7 pages; adding 110 synthetic properties yielded 721 persisted exercise records over 29 bounded pages; command-center discovery results stayed capped at 5; repeated/cross-source observations were retained (7 same-source and 8 cross-source observations on the exercised record, with 2 cross-source duplicates retained in the pagination fixture). Same-property discovery deduplication, explicit unmatched retention, evidence classes, no automatic lead promotion, synthetic-only qualification, PASS retention, and stale-source invalidation were exercised. A material source change invalidated pre-execution analysis/offer authority and cancelled only the unexecuted draft; executed economics remained unchanged and a research-review/buyer-rematch job was recorded.

The `phila-real-estate-transfers` connector remains registered for buyer-activity research only; it produced 0 property observations in this property-source exercise. These capability records remain `NOT_CONNECTED` with a reason and next action: `zillow-listings-fsbo`, `redfin-listings`, `independent-fsbo-sites`, `local-listing-sites`, `listing-description-intelligence`, `public-distress-filings`, `parcel-tax-delinquency`, and `non-philadelphia-public-records`. The available tax-balance dataset is geographically aggregated and is not used to infer parcel delinquency. Zillow/Redfin remarks were not collected.

The public dataset/catalog and documented query endpoint were accessed without authentication or technical workarounds. Dataset metadata identifies the City of Philadelphia License. The linked general City terms page returned HTTP 403 in this environment; it was not bypassed. The feed remains subject to the existing source-terms review gate, and no broader legal conclusion is claimed here.

**Checks:** `pnpm --filter @workspace/property-sources test` — 22/22 passed; `pnpm --filter @workspace/api-server run test:property-discovery-ranking` — 2/2 passed; `pnpm run typecheck` — passed; API build — passed; web build — passed with existing source-map and >500 kB chunk warnings. The web build requires its artifact `PORT` and `BASE_PATH` values; rerun with `PORT=20639 BASE_PATH=/` succeeded. API workflow restarted and reported `Server listening`.

**Next blocker:** permitted access to at least one additional independent listing/owner-sale or jurisdiction-specific public-distress source. Without an approved API/export or other permitted method, P2 broader-source coverage remains partial; do not activate a guessed Zillow/Redfin/FSBO or court-record adapter.

## P6 buyer-demand and P7 portal-access verification

**Exercise date:** 2026-10-08
**P6 result:** persisted workflow behavior passed; this is not evidence of an actual approved/current buyer or a completed live deal.

- `pnpm --filter @workspace/api-server run exercise:buyer-pool` passed against real permitted Philadelphia OPA and recorded-transfer source data in an isolated PostgreSQL schema: **112 discovered prospects, 114 source observations**. The exercise retained source provenance and cross-channel history, kept all discovered prospects unapproved, and confirmed no real workspace prospect was seeded and no communication was sent.
- `pnpm --filter @workspace/api-server run exercise:buyers` passed with explicitly synthetic records: owner-only dated evidence review, current-buying/funding/criteria gates, version conflict and stale-evidence downgrade.
- `pnpm --filter @workspace/deal-domain test` passed **99/99**. Coverage includes deterministic match scores/reasons, current verification, funding/capacity, geography/property/rehab constraints, stale buyer exclusion, and criteria-version stability.
- The persisted `exercise:transactions` passed with explicitly synthetic parties and evidence. It rejected unverified/stale buyers from distribution, rejected a deliberately mismatched current-lead/communicated-offer analysis snapshot before persisting a buyer packet, delivered one identical immutable economics snapshot to multiple selected qualified buyers, kept interest and acceptance non-binding, and elected exactly one winner in a concurrent valid-commitment race while expiring competitors. It also verified address/seller redaction and packet/document economics-hash consistency.

**P7 change in this turn:** the buyer portal's valid `GET /portal/deal` now writes a `PORTAL_ACCESSED` event under a recipient-row lock and adds an audit entry. The event explicitly says it proves bearer-link access only—not the reader's identity, packet delivery, interest, acceptance, or commitment. The operator distribution activity and buyer portal activity render that distinction. Synthetic persisted exercise verified repeated access events, unchanged `INVITED` state, no buyer acceptance/commitment from access alone, and no access record for expired, nonexistent, or committed links. Manual copy-link remains the only available delivery path; no send is claimed.

**Checks:** `pnpm --filter @workspace/api-spec codegen` and its library typecheck passed; workspace `pnpm run typecheck` passed; API typecheck and build passed; web build passed. The web build still emits existing source-map lookup and >500 kB bundle warnings. The API and web managed workflows were restarted; logs show the API listening and Vite ready. Domain tests: 99/99 passed. Persisted exercises `exercise:buyer-pool`, `exercise:buyers`, and `exercise:transactions` passed. The first transaction-exercise run stopped on an assertion-format mismatch (`CALL_READY` versus a space-only regex); the assertion was corrected and the full persisted exercise then passed. Its terminal-worker-failure warning is an explicitly asserted synthetic failure-path case.

**Still unverified:** no live buyer response, owner-approved/current real buyer, permitted outbound delivery provider, delivery receipt, authenticated operator browser session, or real transaction commitment was available. P2 remains PARTIAL; named listing/FSBO/distress feeds remain unavailable as recorded above.

**Next blocker:** a permitted buyer-packet delivery provider that can confirm actual delivery; current capability links are generated for operator copy only and remain NOT_SENT.

## P11 outcome-learning implementation and verification

**Exercise date:** 2026-10-09
**State:** **PARTIAL — implementation mechanics proven; live calibration unavailable until real, source-referenced outcomes exist.** The real development workspace contained zero outcome observations before/after the source reconciliation pass; zero real or synthetic business outcome events were present. The dashboard correctly shows insufficient evidence rather than fabricated performance or a changed rule.

- Added an append-only outcome ledger that idempotently projects canonical call/no-answer and seller-reported answer records, offer authorization/communication attestations, seller portal responses, buyer responses/commitments, and closed/cancelled transaction outcomes. Projection records retain source record ID/type, source label, occurred-at separately from recorded-at, evidence references, synthetic status, confidence/verification state, analysis snapshot and decision version. Seller statements remain seller-reported; owner-entered communication is not represented as provider delivery; portal acceptance is not represented as a signature.
- Added owner-only, idempotent actual ARV/repair capture against the current persisted underwriting snapshot. It rejects a stale snapshot, stores actual values, category totals, source references, confidence, cause categories, and actual-minus-predicted deltas. It does not rewrite prior analysis, offers, packet economics, or authority. Seller-reported actuals are stored as unverified and excluded from calibration samples.
- Added report API and a compact command-center panel for real/synthetic event counts, eligible ARV/repair samples and deltas, missing evidence, recommendation readiness, and recent recorded events. The API persists `INSUFFICIENT_EVIDENCE` status per metric when fewer than five eligible real samples exist. Threshold recommendations are versioned and review-only; approval means “approved for separate change review,” not deployment. Recommendation review requires owner authority, current sample references, append-only history, and supports reopen/reject; live underwriting/economics rules are never changed by this workflow.
- Added canonical reevaluation jobs when actuals are recorded, seller portal responses are recorded, or offer communication is attested. Existing call, buyer-response, and transaction save flows already queue decision reevaluation. Closed/dead-deal reevaluation expires/supersedes obsolete open work.
- **Persisted isolated exercise:** `pnpm --filter @workspace/api-server run exercise:outcome-learning` passed. It persisted four call-derived outcomes, proved replay inserted zero duplicates, separated event/record timestamps, recorded synthetic ARV/repair deltas, verified concurrent idempotency, rejected stale snapshot and non-owner capture, proved source reconciliation idempotency, created a five-sample synthetic threshold preview that is non-deployable and excluded from live recommendations, rejected preview approval, confirmed zero live rule changes, queued one reevaluation job, projected a synthetic close with a one-day planned-vs-realized delta, and left zero open work items after terminal decision reevaluation. All exercise records are in the isolated schema and explicitly synthetic.
- **Automated test:** `pnpm --filter @workspace/api-server run test:outcome-learning` — **2/2 passed**; synthetic samples cannot satisfy the real-sample threshold.
- **Checks:** codegen/library typecheck, API typecheck, web typecheck, API build, and web build passed. Web build warnings: unresolved original source-map positions for existing UI modules and the existing >500 kB bundle notice.
- After the final code batch, the API managed workflow restarted and logged `Server listening`; the web workflow restarted and logged Vite `ready`. The browser preview rendered the logged-out sign-in landing; the authenticated dashboard and seller portal remain unverified in a signed-in browser.
- **Known unverified boundary:** no actual real-world outcome evidence was available, so a real threshold-met calibration recommendation and its approve/reject/reopen lifecycle were not exercised. No calibration was counted from the isolated fixtures. Authenticated dashboard rendering was not verified in a signed-in browser session.

**Current next blocker:** P2 remains the earliest ordered blocker: access to at least one additional independent listing/owner-sale or jurisdiction-specific public-distress source under a permitted, exercisable access method. The existing P2 unavailable-source list remains in force; no restricted connector was added or retried in this slice.

## P9 transaction exception/deadline/evidence-readiness slice

**Exercise date:** 2026-10-09  
**Slice status:** **PARTIAL, not GREEN.** The original exception/readiness layer and the follow-on individual milestone schedule are persisted and synthetic-exercised. No real transaction exists in the workspace, and provider-backed delivery/signing/storage or real closing evidence is unavailable, so P9 is not GREEN.

- Added the canonical `re_transaction_readiness_exceptions` ledger with a unique per-contract/issue key, severity, deterministic reason, evidence references, owner role, one next action, event time, first/last observation time, resolution time/evidence, snapshot hash, synthetic marker, and append-only change history.
- The evaluator reuses the existing contract, transaction-document, buyer-match, evidence, lead-decision, audit, and decision-work models. It identifies explicit closing deadlines, stale economics/documents, missing jurisdiction-approved templates, missing provider-confirmed signing/delivery, unconfirmed packet delivery, missing or mismatched EMD/funds evidence, buyer eligibility changes, decision conflicts/staleness, and transaction integrity mismatches. It does not mark a milestone complete or claim a communication, signature, fund transfer, or close.
- Added an owner-only `POST /deals/{id}/contract/deadline-schedule` operation and command-center form. It requires a review disposition for title, inspection, EMD, assignment, and buyer-funds milestones; each is explicitly a calendar due date, no fixed date, or not applicable. A dated item requires a real date, valid IANA time zone, source-grounded basis note, and link to the currently executed agreement or latest amendment. The form does not infer dates or mark completion.
- Schedules are append-only revisions with idempotency keys, review actor/time, source evidence/effective time, and a deterministic terms/party hash. Changes to closing terms, authorized economics, document, signatures, or committed buyer make the prior schedule stale. Re-review creates a new schedule version; schedule replay does not duplicate history or side effects.
- The evaluator creates idempotent upcoming/overdue/invalid-date exceptions for applicable individual milestones, retaining date and time zone as evidence rather than inventing a timestamp. It resolves those issues only when the schedule or linked milestone evidence actually resolves them. An active executed transaction with no complete current schedule is blocked. Settlement additionally requires a current schedule tied to the latest terms and party; each recorded milestone now requires linked evidence and distinct actual-event and record timestamps. A schedule by itself never completes a milestone.
- Deadline issue keys include the persisted closing date. A documented closing amendment resolves the old deadline issue with history evidence and creates a distinct issue for the amended date; the earlier issue is not overwritten. Issue rows are idempotent on repeated evaluation. Material exception changes reevaluate the existing canonical decision engine, and the scheduled `REVIEW_DEADLINES` worker runs the evaluator every five minutes. Terminal closure resolves exceptions and leaves no runnable decision-work item.
- Added authenticated `GET /transaction-readiness` for OWNER/OPERATOR/ANALYST and a compact dashboard readiness panel that shows the three highest-priority open exceptions with a working expand/collapse control for the complete open list. The API reports live vs. synthetic transaction counts and signing, delivery, and private-document-storage capability status. An unauthenticated request returned HTTP 401 with the existing sign-in-required response. No authenticated browser session was established; the screenshot showed only the logged-out sign-in landing.
- Private storage remains `PRIVATE_FILE_STORE_UNAVAILABLE`: review-copy bytes stay in the protected persistent database-blob table. The legal template registry reports missing jurisdiction-approved templates; signing and external delivery providers remain `NOT_CONNECTED`. These are explicit readiness blockers, not simulated integrations.
- **Development database check:** `re_contracts` contained **0 transactions, 0 synthetic transactions, 0 active transactions**. No real transaction/funds/signature evidence was seeded.
- **Latest persisted isolated exercise:** `pnpm --filter @workspace/api-server run exercise:transaction-readiness` passed in a synthetic schema: **1 synthetic transaction / 0 real transactions**; **24** persisted exception records, **7** open before terminal closure, and **24** resolved at terminal closure. Deadline schedule history held versions **1 and 2**. It exercised missing-schedule blocking, owner-only review, rejection of a non-current source reference, idempotent replay, overdue title and upcoming inspection/EMD dates, no auto-completion from schedule, event-time vs record-time, resolution after inspection evidence, staleness after an amendment and buyer-party change, owner re-review, and a current-schedule settlement gate. Existing delivery/template/storage, stale-document/economics, EMD/funds mismatch, amendment, and terminal-work cases also passed. After closure: **0 open exceptions**, **0 runnable decision-work items**, all **24** transaction exceptions resolved. Synthetic results are not live deal evidence.
- The exercise emitted one `MATCH_BUYERS` worker-failure warning in its deliberate terminal-failure scenario; the test asserted `FAILED`, the isolated run exited successfully, and no unhandled exercise failure remained.
- **Automated tests/typechecks:** `pnpm --filter @workspace/api-server run test:transaction-readiness` — **5/5 passed**, including explicit IANA-zone calendar dates, upcoming/overdue/invalid cases, idempotent hashing, term/party staleness, and schedule completeness. `pnpm --filter @workspace/api-spec run codegen` (which ran `typecheck:libs`), API `typecheck`, and web `typecheck` all passed.
- **Builds:** API `build` passed. Web build passed with `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build`; it emitted the existing source-map-position warnings and >500 kB bundle warning, but exited successfully. No database migration/push was required for this JSONB-backed schedule.
- **Runtime/browser boundary:** Both managed API and web workflows were restarted and reported ready. The preview screenshot showed the logged-out sign-in landing; the authenticated command center and this signed-in form were not browser-verified because the capture browser has no authenticated owner session. No authentication bypass was used.

**Next blocker:** P2 broad-source coverage remains externally blocked: obtain a genuinely permitted, currently exercisable independent property source before adding another connector. Do not retry unavailable Zillow/Redfin/FSBO/distress feeds without new access; do not count synthetic transaction exercises as live source/deal proof.

## P10 API-backed command-center/readiness UX

**Exercise date:** 2026-10-09  
**Slice status:** **PARTIAL, not GREEN.** Persisted API-backed behavior and UI state rules are exercised, but the actual authenticated command center and seller portal were not inspected in a signed-in browser. No authentication bypass was attempted.

- “Refresh desk” now refetches both `/deals/command-center` and `/transaction-readiness`; its busy state covers both requests.
- Command-center presentation distinguishes initial loading, empty persisted workspace, actionable data, 401 unauthenticated, 403 forbidden, stale cached data after a failed refresh, and a service/network failure. Cached private data is hidden for 401/403. There is no mock-data fallback.
- The selected next action displays recommendation status, authorization requirement, evidence references, and the primary blocker in the main content rather than only in a collapsed trace. Existing role/responsible guidance remains visible. The page explicitly says opening an operation link does not itself perform or confirm the operation.
- Transaction readiness now includes persisted jurisdiction-specific template status and reason/next-action per template, alongside exact signing, delivery, and private-storage state/reason/next-action. With no property jurisdiction it returns `NOT_EVALUATED`, not a guessed jurisdiction. The review worksheet remains distinct from legal templates; prepared content is not shown as signed.
- The buyer/distribution summary uses persisted buyer records, counts only active `APPROVED` + `VERIFIED` + currently `BUYING` records with unexpired evidence and no qualification blockers, reports stale/unverified exclusions separately, and excludes explicitly synthetic exercise records from live totals. Delivery state comes from the readiness API and stays `NOT_SENT` without a connected provider; invitations or copied links are not represented as sent.
- No mutation or external action was added to these cards. Existing links open their authorized workflow; each protected save/action remains server-gated and must return a confirmed result.

**Automated/API verification**

- `pnpm --filter @workspace/api-spec run codegen` — passed; generated API client/Zod schemas and workspace library typecheck passed.
- `pnpm --filter @workspace/api-server run test:command-center` — **9/9 passed**: 3 existing call-display cases; loading/empty/ready/error states; 401/403 cached-data hiding; stale cached-data state; current buyer eligibility and synthetic/stale/unverified exclusions; actual unauthenticated HTTP requests to both command-center and transaction-readiness endpoints returned 401; injected service failure returned the generic 500 response without disclosing the internal message.
- `pnpm --filter @workspace/api-server run test:auth` — **7/7 passed**, including owner-only role denial (403) for protected access; no signed-in HTTP fixture was used.
- `pnpm --filter @workspace/api-server run test:transaction-readiness` — **5/5 passed**.
- `pnpm --filter @workspace/api-server run exercise:command-center` — passed in the isolated persisted schema. It checked a zero-record workspace (no fake records), provider-unavailable reasons/next actions, `NOT_SENT`, no-jurisdiction template state, a real property-jurisdiction template blocker in the synthetic fixture, role-specific persisted next actions, automation lane status, and worker state.
- `pnpm --filter @workspace/api-server run exercise:decision-work-lifecycle` — passed in an isolated synthetic schema: one concurrent claim winner; idempotent completion; retry success; 3-attempt bound; terminal failure; stale evidence blocked/expired; authorization denial; expiry recovery; worker completion; 67 work events and 87 audit rows.
- `pnpm --filter @workspace/api-server run typecheck` and `pnpm --filter @workspace/radical-deal-os run typecheck` — passed.
- `pnpm --filter @workspace/api-server run build` — passed.
- `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` — passed. Vite emitted existing source-map lookup warnings and the >500 kB chunk warning. Initial invocations without required artifact environment values failed first for missing `PORT`, then missing `BASE_PATH`; the correct artifact values were used for the passing build.

**Runtime/browser boundary:** API and web managed workflows were restarted and logged `Server listening` / Vite `ready`. Preview screenshot showed the logged-out sign-in landing, with no browser runtime error; Clerk displayed its development-key warning. The capture browser has no owner session, so no signed-in dashboard, seller portal, or owner-action result was verified. The API tests proved unauthenticated denial only; 403 behavior was covered at the role-middleware and client-state levels, not by a signed-in HTTP request.

**Data truth:** all persisted command-center fixtures and decision-work counts above came from isolated synthetic exercises. No real buyer, seller conversation, external delivery, signature, fund event, or transaction was created or claimed.

**Ordered master blocker:** P2 is still the earliest non-GREEN item: a new independent property source needs permitted, exercisable access. Do not retry the already unavailable listing/FSBO/distress feeds without new access.

**Durable next implementation task after this slice:** build the source-backed, editable, versioned seller motivation/negotiation playbook requested by the founder. Treat all situations as hypotheses until seller evidence confirms them; add discovery questions, empathy-first framing, objection responses, alternative structures, risks, cadence, prohibited promises, escalation gates, and evidence that confirms/refutes each hypothesis. Add the structured, jurisdiction-gated clause/addendum review boundary without auto-inserting unreviewed legal text. Keep deterministic economics and offer authority unchanged unless a separately authorized versioned calculation is completed. Persisted exercises must use synthetic labels; no real seller conversation or legal review is implied.

**Turn state:** implementation and verification for this accepted slice are stopped at turn end. The configured web/API workflows are running; queued suggestions or backlog notes do not execute automatically.

## Seller motivation and negotiation playbook (#39) — 2026-10-09

**Status:** Implemented and synthetic-persisted-exercised. This adds call-flow guidance; it does not establish seller motivation, contact a seller, authorize terms, or create legal documents.

- Added a 15-entry, source-linked playbook covering seller-situation hypotheses and common objections. Each entry includes questions, empathy-first response guidance, optional negotiation structures, follow-up guidance, risks/escalations, do-not-promise boundaries, and evidence that could confirm or refute the hypothesis.
- Added persisted playbook entries and append-only revision history. Seeding is idempotent; owner-only edits require a reason and expected version, preserve source/matching provenance, and reject stale revisions.
- Added GET/PUT API contracts and generated client hooks. GET is membership-protected; edits are OWNER-only.
- Integrated the persisted playbook directly below the existing seller call brief. Seller-reported related topics sort first but remain INDICATED and explicitly “to confirm”; property flags and AI hypotheses do not trigger a motivation match. All entries are expandable, and the owner can revise them in place. Suggestions do not update lead economics, offer authority, seller communications, or transaction state.
- Added `docs/seller-negotiation-playbook-sources.md`. Two public Harvard PON references are used only for general listening/question methods. Situation labels and negotiation guidance are original synthesis, not sourced facts about a seller. No legal language is generated or represented as approved.

**Persisted exercise:** `pnpm --filter @workspace/api-server run exercise:seller-playbook` — passed in an isolated PostgreSQL schema and labeled synthetic. It persisted 15 seeded entries, a synthetic seller-reported INDICATED statement, matching evidence reference, and revision 1→2; a stale version edit was rejected; revision/audit rows were present; lead stage/version/asking price and analysis were unchanged. The isolated schema was cleaned up. No real call or seller outcome was used.

**Checks:**

- `pnpm --filter @workspace/api-spec run codegen` — passed after aligning component-schema names with generated operation types.
- `pnpm --filter @workspace/db run push` — passed; only the development schema was updated with the playbook tables.
- `pnpm --filter @workspace/deal-domain test` — **103/103 passed**, including four focused playbook tests for topic coverage, public/AI evidence exclusion, seller-reported confirmation questions, and no automatic price/term/clause changes.
- `pnpm --filter @workspace/api-server run test:auth` — **7/7 passed**, including OWNER-only role enforcement.
- API server and web typechecks — passed.
- `pnpm --filter @workspace/api-server run build` — passed.
- `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` — passed; existing source-map lookup and >500 kB chunk warnings remain.
- API/web managed workflows were restarted and reported `Server listening` / Vite `ready`. Preview screenshot showed the logged-out sign-in page without browser console errors. The capture has no authenticated owner session, so signed-in rendering and owner editing were not browser-verified.

**Real-vs-synthetic boundary:** the persisted exercise was synthetic only. No real seller contact, seller response, negotiation, offer change, legal review, signature, or external action occurred or is claimed.

**Next buildable slice:** jurisdiction-gated clause/addendum request and qualified-review workflow at the existing transaction boundary; keep generated/unreviewed language blocked and do not invent legal templates. P2 remains the earliest overall external blocker: no newly permitted/exercisable independent listing source was established in this turn.

**Turn state:** this accepted implementation turn is stopped. No background task is running; web and API workflows are running.

## Source-backed seller operational intelligence — 2026-10-10

**Status:** The bounded slice is implemented and verified in the existing seller playbook/call brief. This is source-attributed educational guidance plus synthetic persistence verification; it is not real-deal field validation. No new app or parallel subsystem was created.

- Reused the 17-entry persisted playbook, source provenance, revision history, GET/owner-only PUT service, and seller call brief. Added structured optional source metadata (author, title, URL, publication date, access context, topic, market/jurisdiction, material type, source-claim status) and operational-intelligence fields (source claim, synthesized method, rationale, supporting/refuting evidence, next question/action, human decision, and explicit no-real-outcome-validation state).
- Added `evidence-backed-reo-offer-review` for REO/bank-owned underwriting context and `permission-aware-text-follow-up` for seller-conversation sequencing. The UI displays the source claim as unvalidated, the independent synthesis, applicability/refutation evidence, next action, human decision, and no-real-outcome notice. It is mounted below the existing call brief at `artifacts/radical-deal-os/src/pages/calls.tsx:80`; the source data is served by the existing membership-protected GET API at `artifacts/api-server/src/routes/deals.ts:66`, with owner-only edits at line 69.
- Motivation remains a hypothesis unless relevant seller-reported evidence exists. Public/property/AI signals still do not establish a motivation match. Guidance cannot send communication, alter deterministic underwriting, modify terms, create offer authority, or insert legal language.

**Source/access record (accessed 2026-10-10):**

- Jerry Norton / Flipping Mastery, “5 Tips For Getting Bank Owned REOs Cheap,” `https://flippingmastery.com/5_tips_for_getting_bank_owned_reos`: public article fetched without sign-in/payment; no publication date or byline was displayed, author attribution is from the site. The entry is limited to REO context and treats the repair/offer assertions as educator claims, not facts or validated results. Dual-agency, inspection-waiver, and higher-EMD suggestions are not adopted.
- Pace Morby, “Texting Script,” `https://resources.pacejmorby.com/wp-content/uploads/2024/01/Texting-Script.pdf`: one-page PDF accessed directly through the official public freebies catalog, without login/payment/form submission. It has no PDF byline or displayed publication date; PDF metadata creation date 2023-12-08 is recorded only as technical metadata, not publication. The playbook paraphrases the sequence (confirm context, invite discussion, then ask seller price/timing and arrange follow-up); it does not reproduce the script wording or claim effectiveness.
- FlipMan’s public site was reachable, but the substantive starter pack was offered as a paid $27 product/members content. No gated content was accessed or incorporated; no FlipMan method is claimed as sourced in this slice. The two Harvard PON citations remain general listening/question references only.

**Verification:**

- `pnpm --filter @workspace/api-spec run codegen` — passed; generated schemas/client and workspace library typecheck passed.
- `pnpm --filter @workspace/deal-domain test` — **104/104 passed**, including source attribution/material type, source-claim status, exact synthesized sequence, hypothesis boundaries, and no automatic price/term/clause changes.
- `pnpm --filter @workspace/api-server run test:auth` — **7/7 passed**, including owner-only role enforcement.
- `pnpm --filter @workspace/api-server run exercise:seller-playbook` — passed in isolated PostgreSQL schema, synthetic only: 17 library entries; both source-backed entries present; synthetic seller-reported evidence mapped to the existing call-brief relevance; revision 1→2 persisted, stale edit rejected, audit rows present; lead stage/version/asking price and analysis unchanged; offer records unchanged (`offerAuthorityUnchanged: true`); no real outcome validation. Isolated records were cleaned up.
- API typecheck and web typecheck — passed.
- `pnpm --filter @workspace/api-server run build` — passed.
- `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` — passed. Existing source-map lookup warnings and >500 kB bundle warning remain.
- API and web managed workflows restarted; API logged `Server listening`, web logged Vite `ready`. Signed-in browser rendering was not verified; the capture environment has no authenticated owner session. No auth bypass was attempted.

**Remaining boundaries:** No real seller conversations or project deal outcomes exist in this exercise; no educator tactic is described as field-validated by this project. Substantive FlipMan content remains unavailable behind paid access. Buyer/disposition and transaction guidance still require their own freely accessible source material before source attribution can be claimed for those topics.

**Next implementation task:** build the jurisdiction-gated clause/addendum request and qualified-review boundary at the existing transaction/document workflow; never auto-insert unreviewed legal language. **Overall earliest blocker remains P2:** a new permitted, independently exercisable property source is not available; do not retry unavailable feeds without new access.

**Turn state:** this accepted slice is complete and stopped at turn end. No background Agent task is running; API, web, and mockup workflows are running.

## Clause request intake at transaction boundary — 2026-10-10

**Status:** Partial and operationally fail-closed. This advances the next buildable P8 transaction step but does not complete qualified legal review, template approval, signing, or execution.

- Reused the existing transaction-document readiness registry and `DealOperationsPanel`; added an owner-only, deal-linked special-clause/addendum request path with persisted category, purpose, saved-property jurisdiction, source/template reference, party scope, affected terms, conflicts, and optional owner-supplied proposed text.
- Requests are idempotent and append-only, versioned, actor/timestamped, and audited. A jurisdiction mismatch is rejected. The API and UI explicitly identify supplied language as `OWNER_SUPPLIED_UNREVIEWED`; no clause is generated or inserted into a contract or buyer packet. A matching approved template would only move the request to `AWAITING_QUALIFIED_REVIEW`; current missing templates produce `BLOCKED_MISSING_APPROVED_TEMPLATE`.
- Added the request table to the development schema, authenticated GET / owner-only POST API, generated OpenAPI client/Zod types, and a request form/list inside the existing purchase-document panel. An unauthenticated live API GET returned HTTP 401.
- `pnpm --filter @workspace/db run push` — passed against development schema only.
- `pnpm --filter @workspace/api-spec run codegen` — passed; generated API schemas/client and library typecheck passed.
- `pnpm --filter @workspace/api-server run exercise:clause-review` — passed in the isolated synthetic schema: request persisted; exact replay returned the same request; template absence remained blocked; review remained `NOT_REVIEWED`; owner-only denial and jurisdiction mismatch were rejected; exactly one audit event existed; lead version/state remained unchanged; no auto-insertion.
- API and web typechecks passed. API and web builds passed. `pnpm --filter @workspace/api-server run test:auth` — 7/7 passed. The web build still reports pre-existing sourcemap and large-chunk warnings.
- API/web workflows were restarted and reached listening/ready states. The signed-in owner UI was not browser-verified; no authenticated owner session was available and no bypass was attempted.

**Remaining boundary:** No approved jurisdictional legal template or qualified reviewer evidence is registered. There is no review-response/approval operation, approved-clause versioning, stale-document invalidation from clause approval, or insertion workflow. Those must be implemented only against actual approved template and reviewer evidence; the current intake must not be presented as legal review or ready-to-use language. No real legal review occurred.

**Next buildable milestone:** add the qualified-review evidence and approved-template registration/decision path to the existing transaction document registry, then propagate approved clause versions into document staleness checks. **Earliest overall external blocker remains P2:** access to another permitted, independently exercisable property source.

**Turn state:** implementation and verification stopped at turn end; no background Agent task is running. API, web, and mockup workflows are running.

## Seller playbook citation authorization + buyer disposition guidance — 2026-10-10

**Task #42 status:** Implemented and persisted-exercised in the existing playbook flow.

- Extended `artifacts/api-server/src/services/seller-playbook-exercise.ts` to compare citation identity/provenance from the saved entry with revision-table records and actual seller-playbook endpoint reloads. A synthetic entry survives service revision v1→v2 and an owner endpoint revision v3 with identical citation provenance; 3 revision rows and 3 audit events remain.
- The exercise invokes the registered handlers from `artifacts/api-server/src/routes/deals.ts` and the real `membership`/`roles("OWNER")` middleware against isolated PostgreSQL membership records. Owner GET/PUT and operator GET returned 200; pending-member GET and operator PUT returned 403. Denied responses contained no entries/citations; denied mutation created no revision; stale version edit remained rejected. This route-handler/middleware exercise uses a synthetic actor context and isolated DB; it is not an authenticated browser or live Clerk session.

**Task #41 status:** Integrated into the existing seller call brief; general guidance is explicitly labeled internal synthesis.

- `artifacts/radical-deal-os/src/components/seller-playbook-panel.tsx` now reads the existing persisted deal-operations/matching API and displays eligible buyer count, excluded buyer count with persisted mismatch reasons, explainable match reasons, persisted contract status/version, and the server's current next action.
- The call-brief section adds buyer buy-box/verification/funding/capacity/closing checks, matching/disposition guidance, package-readiness caveats, and approval boundaries. It explicitly says a match is not approval, delivery, or commitment; it shows no synthetic-as-live metrics and does not send/distribute or change economics.
- No new buyer-education source was accessed or claimed. The generic methods are labeled internal synthesized guidance; the existing Norton/Pace seller guidance retains its original source and access limitations.

**Verification:**

- `pnpm --filter @workspace/deal-domain test` — 104/104 passed.
- `pnpm --filter @workspace/api-server run test:auth` — 7/7 passed.
- `pnpm --filter @workspace/api-server run exercise:seller-playbook` — passed, synthetic isolated DB: 17 library entries; actual endpoint statuses owner GET 200, operator GET 200, pending GET 403, operator PUT 403, owner PUT 200; citation identity/provenance preserved through revision and endpoint reload; stale edit rejected; revision rows 3; audit events 3; persisted deal-operations returned 0 buyers and no contract in the isolated empty workspace, with a real next-action string; economics and offer authority unchanged; no real deal outcome validated.
- API and web typechecks passed. API build and web build passed; web build continues to emit existing source-map resolution and >500 kB bundle warnings.
- API, web, and mockup workflows are running. No authenticated-owner browser exercise was performed.

**Remaining limitations / next milestone:** No real approved/current buyer records or buyer-distribution provider evidence were present in the isolated exercise; the buyer summary is live-API-backed but not proof of a real buyer network. The next safe buildable P8 milestone is the qualified-review evidence path for actually approved jurisdictional templates, followed by clause-version staleness propagation. Do not fabricate counsel approval or templates. P2 broader property sourcing remains the earliest overall blocker and still requires a newly permitted, independently exercisable source.

**Turn state:** implementation stopped at turn end; there is no background Agent task. Existing API/web/mockup workflows remain running.

## Jurisdiction template review + stale transaction-document guard — 2026-10-10

**Status: PARTIAL, not GREEN.** The code and isolated synthetic exercise now cover the core fail-closed eligibility and stale-send guard. No real legal template, qualified reviewer, legal approval, signature provider, or signed-in HTTP session was verified.

- Added fail-closed template eligibility checks for matching jurisdiction, approved status, template hash, source/provenance, approval and review evidence, reviewer identity/qualification reference, effective/expiry dates, and supported deal type. Added registry fields for that review metadata and applied the development schema update with `pnpm --filter @workspace/db run push`.
- Added the owner-only `POST /transaction-document-templates/{id}/review` API operation. The persisted isolated exercise records a synthetic template review, verifies the version increment and provenance, and verifies that an OPERATOR call is rejected by the service authorization gate. The route is wired through `roles("OWNER")`; the generic auth suite passed, but an authenticated HTTP integration test against this specific route was not run.
- A read-only command-center fetch no longer writes transaction state. When an operator attempts an approval/send/signing transition for a document whose offer, analysis, terms, or party snapshot is stale, the write path persists `STALE`, reason, next action, transition event, and audit entry, then rejects the attempted transition. Download of a stale document remains blocked. The isolated transaction exercise asserts these behaviors on synthetic data.
- Synthetic template-review metadata is an exercise fixture only; it is not a real approved legal template and does not enable legal-document sending. Template bytes/storage, signing, legal review, and real transaction use remain unavailable/unverified. No underwriting, offer-authority, or economic calculation is performed by the review service.

**Verification completed:**
- `pnpm --filter @workspace/api-spec run codegen` — passed; generated libraries typecheck passed.
- `pnpm --filter @workspace/deal-domain test` — 105 passed, 0 failed.
- `pnpm --filter @workspace/api-server run test:auth` — 7 passed, 0 failed. This covers the role middleware generally; see route-specific limitation above.
- `pnpm --filter @workspace/api-server run typecheck` — passed.
- `pnpm --filter @workspace/api-server run build` — passed.
- `pnpm --filter @workspace/radical-deal-os run typecheck` — passed.
- `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` — passed with existing source-map resolution and >500 kB chunk warnings.
- `pnpm --filter @workspace/api-server exec tsx src/services/isolated-exercise.ts transaction-exercise.ts` — passed in a temporary isolated PostgreSQL schema. It verified synthetic template review/versioning and role denial, stale unsigned document persistence, send/download blocking, audit event, and transaction readiness paths. It reported 1 synthetic transaction and 0 real transactions. A worker retry warning was logged during the exercise; the exercise completed successfully.

**Remaining gaps:** The review API records owner-submitted reviewer/evidence references; the system does not independently validate a lawyer's identity or legal approval. No real legal template can become operational from this exercise. HTTP-level 401/403 coverage for the specific review route and a direct before/after persisted economics assertion remain unverified, so this milestone is not GREEN.

**Next milestone:** Build the shortest usable, API-backed command-center path from actual permitted property observations through qualification blockers, available underwriting assumptions, call brief/notes, and one truthful next action. Do not manufacture contactability or buyer availability. Show a concrete blocker and feasible workaround where external capability is missing.

**Turn state:** implementation stopped at turn end; no background Agent task is running. API, web, and mockup workflows are running.

## Connected acquisition-to-call verification and immediate document staleness — 2026-10-13

**Status: PARTIAL overall.** The selected API/document safety behaviors passed isolated exercises. The seller workflow foundations are now exercised together across actual permitted discovery data and explicitly synthetic acquisition/call fixtures. This is not proof of a real seller call, authenticated owner browser session, live direct contactability, or live deal.

- Added an HTTP-testable router factory for the actual transaction-template-review endpoint, while production still mounts the route behind the existing Clerk authentication, workspace membership, and owner-only role gates. The persisted exercise used a synthetic test-session middleware against that same route: OWNER review returned 200 and persisted a new template version; OPERATOR returned 403; replay with the old template version returned 409. Synthetic review provenance remained marked synthetic.
- Added a persisted before/after comparison around template review for analysis snapshot, ARV/repair/MAO outputs, and authorized offer amount/max-authority fields; those values were unchanged.
- Added transaction-document freshness reconciliation and wired it after lead party/evidence/contact/underwriting/stage/call mutations, offer draft/authorization/communication/withdrawal, and contract create/exception writes. It marks affected unsigned DRAFT/PREPARED/APPROVED_TO_SEND documents `STALE` with reason, next action, system event and audit entry. Re-running reconciliation produces no duplicate stale event. Existing send/signature and download guards reject stale artifacts.
- Reused the existing command center, source registry, selective-qualification path, deterministic underwriting and acquisition queue/call brief; no replacement UI or CRM module was added. The live-source property exercise persisted **594 unique Philadelphia OPA discoveries**, **0 active leads created from raw discovery**, and **165 unmatched source observations**. It also exercised L&I violations (96 observations/87 matches), unsafe buildings (87/87), vacancy (87/87), permits (90/87), demolitions (104/87), and sheriff-deed records (730 observations/594 matches; 17-page traversal reported 651 source records). Philadelphia real-estate-transfer connector was registered but not run in that property exercise. No direct phone/email/web contact route was available from those feeds.
- The synthetic property-source workflow exercised evidence-backed promotion, synthetic comps/repairs and deterministic underwriting, CALL_READY transition, persisted synthetic call result, and command-center next action. The separate acquisition-queue exercise passed current-route CALL NEXT, postal/no-route/stale/conflict blockers, call brief, structured seller-answer evidence, stale-analysis/offer invalidation, and call-result audit behavior. Synthetic data remains synthetic; it does not increase live seller/buyer/deal counts.

**Checks completed:** deal-domain tests 105/105; API auth tests 7/7; API typecheck/build passed; web typecheck/build passed (existing source-map resolution and >500 kB bundle warnings); isolated transaction exercise passed (1 synthetic transaction, 0 real); live-source property exercise passed; isolated acquisition-queue exercise passed. The transaction exercise emitted an expected worker retry warning for a synthetic `MATCH_BUYERS` job but completed successfully. API workflow was restarted and logged `Server listening`; web and component-preview workflows are RUNNING.

**Remaining proof limits:** The endpoint HTTP test used controlled test-session middleware; it did not exercise a real Clerk owner session. The signed-in command-center browser remains unverified. Seller contactability from the permitted live property feeds is unavailable; the source-to-call tests that pass the phone gate use explicit synthetic evidence. No real buyer response/provider, legal approval, signature, or closed transaction was proven. P2 remains externally blocked for additional permitted sources; do not call it green.

**Next milestone:** Make the authenticated command center show the live persisted Philadelphia discovery/qualification pool with clear missing-contact and underwriting blockers, then support the tested call-note path without presenting synthetic data as live. Keep the current API/backend foundations and do not claim CALL READY when direct contact evidence is absent.

**Turn state:** this accepted turn stopped after verification; no Agent build is running in the background. Tasks #43 and #44 remain in the project task queue and were not treated as executing work.

## Follow-through: HTTP template review, economics invariants, and connected call workflow — 2026-10-13

**Status: verified synthetic behavior; live workflow still PARTIAL.**

- Exercised the actual template-review route over HTTP through a controlled test-session middleware using the route's real OWNER role guard and review service. OWNER returned 200 and persisted the version/review metadata; OPERATOR returned 403; replaying the stale template version returned 409. This is not a real Clerk/browser session.
- Persisted before/after snapshots around review proved analysis snapshot, ARV, repair estimate, MAO, and authorized offer amount/max-authority values were unchanged.
- Added an idempotent freshness reconciler and wired it after operator/API writes to seller/property/contact evidence, underwriting, lead transition, calls, offer creation/authorization/communication/withdrawal, source research/comps, contract creation, and contract exception handling. A persisted synthetic material-evidence change immediately invalidated analysis/offer authority and staled the unsigned document with reason, next action, audit event and `STALE` history; a second reconciliation added no duplicate event. Download and send/signing attempts were rejected. A persisted comparison proved staling did not further alter the post-evidence analysis pointer or offer amount/max limit.
- The existing command center and workflow were reused rather than replaced. The live permitted-source exercise plus isolated synthetic acquisition exercises covered source discovery → evidence-backed qualification → deterministic underwriting → CALL NEXT/call brief → recorded seller-call evidence → updated next action. No operator UI code changed in this slice, and the signed-in browser was not exercised.

**Results:** domain 105/105; API auth 7/7; API typecheck/build passed; web typecheck/build passed with existing source-map and large-chunk warnings. Persisted transaction, property-source, and acquisition-queue exercises passed. The property exercise persisted 594 unique OPA discoveries, 0 raw-discovery-to-active-lead promotions, and 165 unmatched observations; it recorded 96 L&I violation, 87 unsafe-building, 87 vacancy, 90 permit, 104 demolition, and 730 sheriff-deed observations. The live permitted feeds returned 0 phone/email/web contact routes. Qualification, underwriting, and call behavior in the seller workflow exercise used explicit synthetic fixtures; no real call, seller, buyer, or transaction was created. API workflow restarted and logged `Server listening`; API, web, and component-preview workflows are RUNNING.

**Remaining limitation:** stale reconciliation is wired synchronously after the listed API mutation routes and source-research endpoints, but runs after the source write commits rather than atomically in the same transaction. It is not a database-wide trigger for arbitrary direct writes or every future worker/provider; send/signature/download guards still fail closed if reconciliation has not run. No actual Clerk-authenticated HTTP owner session, live seller contact route, buyer response, legal approval, signature, or closing was proven. Do not mark the whole workflow GREEN.

**Next milestone:** verify the existing command-center presentation with a legitimate owner session and surface the live empty/contact-blocked property pool without making synthetic fixtures look live. Existing project tasks #40 and #44 cover adjacent work; no new duplicate task was created.

**Turn state:** stopped at turn end; no background Agent task is running.

## Dashboard live discovery pool and call-note refresh — 2026-10-13

**Status: API-backed source visibility and synthetic call-note path verified; signed-in browser and real seller path remain unverified.**

- Added an authenticated command-center panel backed by the persisted, paginated Philadelphia property-discovery API. It shows raw/candidate/qualified/CALL READY/pass counts and up to five records with status, deterministic relevance reason/score/confidence, missing/promotion blockers, next action, source name/ID/URL, classification/confidence and last-observed time. The full pool remains on the existing paginated Sources page.
- The panel labels only explicitly exercised Philadelphia connector IDs as `Live public source`; source IDs containing synthetic/fixture/test are shown as `Synthetic exercise`; other or missing provenance is explicitly unverified/no-provenance. It does not substitute fixture records.
- Added a fail-closed contact presentation: postal-only, missing direct route, stale/unpermitted route, or non-CALL_READY status cannot expose the CALL NEXT link. No-route rows direct the operator to permitted owner/contact research or documented manual evidence, without claiming the action has happened. Underwriting is shown only when a current persisted analysis is linked, with assumption summary, calculation date, blockers and risks.
- “Refresh desk” now refreshes the discovery pool as well as command-center and transaction readiness. Successful call-note persistence invalidates acquisition queue and property-discovery queries in addition to the existing lead/dashboard/audit queries. The existing call form remains disabled until the server confirms call-work readiness; no call is placed.
- Added six command-center state tests (including live-vs-synthetic/unknown provenance labels and contact-readiness gates). Existing API auth tests and persisted property-source/acquisition-queue exercises cover authorization, no raw-discovery promotion, and call-note persistence/reconciliation.

**Verification:** web typecheck passed; state tests **6/6 passed**; web build passed with existing source-map and >500 kB bundle warnings. API typecheck, auth tests **7/7**, and API build passed. Persisted live-source property exercise passed: **594** unique OPA discoveries, **0** raw discoveries auto-promoted to active leads, **165** unmatched observations; qualifying counts by source remain as in the preceding checkpoint section. Persisted synthetic acquisition-queue exercise passed, including note persistence and material-evidence invalidation. Anonymous HTTP checks returned **401** for both `/api/property-discoveries` and `/api/acquisition-queue`.

**Browser/workflow:** preview screenshot reached the public sign-in landing page only; no legitimate signed-in session was available to the capture browser, so command-center UI acceptance is not claimed. Web and API workflows are RUNNING and their restart logs show Vite ready and API `Server listening`; mockup-sandbox is not started and is not required for this app.

**Remaining gap/next task:** complete a signed-in owner browser smoke test using a legitimate session, then verify the rendered discovery records and call-note refresh from that session. Do not bypass auth or represent the synthetic call fixtures as live.

**Turn state:** stopped after implementation and checks; no background Agent task is running.

## Block 16 — Property intake, deduplication, and provenance — 2026-10-14

**Status: PARTIAL; source normalization, duplicate handling, replay protection, and raw-to-lead separation are implemented and verified. Conflicting source identities fail closed, but a persisted owner-review/resolution workflow for the rejected conflicting candidate remains the next task.**

- `recordPropertyObservation` now rejects blank source keys, missing source record IDs/providers, invalid source URLs, and non-HTTP(S) links before creating a discovery.
- An existing stable source-record key cannot be reassigned to another provider, source ID, parcel, or normalized property identity. The operation returns a conflict and leaves the prior source observation and property linkage unchanged.
- Exact same-timestamp/same-content replay is a no-op for the property discovery version and `seenCount`. A retry at a later retrieval time remains a new observation.
- Material changes to a source record attached to the same parcel retain a bounded 20-version history in the persisted source observation payload, including prior normalized property snapshot, source ID, source URL, and observation time. The existing API source-history surface also identifies retained property-record versions. No observations are merged away when separate feeds refer to the same exact parcel.
- The current connector normalization is labelled `property-record-v1`. Raw observations remain separate from qualified leads; no source discovery becomes a lead or CALL READY without the existing explicit human promotion and downstream gates.
- Added isolated persisted-exercise assertions for same-capture replay, missing source ID, conflicting identity rejection with prior-row preservation, changed-record lineage, exact-parcel cross-source deduplication, and no raw-to-lead promotion. Existing stale-source/freshness checks remain in the exercise.

**Verification completed:**

- `pnpm --filter @workspace/api-spec run codegen` — PASS; generated library typecheck passed.
- `pnpm --filter @workspace/api-server run exercise:property-source` — PASS against permitted Philadelphia public-source records and the isolated exercise schema. Reported **588 persisted unique discoveries, 171 unmatched source observations, and 0 active leads created from raw discovery**. Synthetic replay/conflict/version fixtures were isolated and explicitly labelled.
- `pnpm --filter @workspace/api-server run test:property-discovery-ranking` — PASS, **2/2**.
- `pnpm --filter @workspace/deal-domain exec tsx --test src/*.test.ts` — PASS, **105/105**.
- `pnpm --filter @workspace/api-server run test:auth` — PASS, **7/7**.
- API and web TypeScript checks — PASS (`pnpm --filter @workspace/api-server run typecheck`; `pnpm --filter @workspace/radical-deal-os run typecheck`).
- API and web builds — PASS (`pnpm --filter @workspace/api-server run build`; `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build`). Existing large-bundle/sourcemap warnings remain.
- Restarted `artifacts/api-server: API Server` and `artifacts/radical-deal-os: web`; both reported RUNNING, with the API listening and Vite ready.
- HTTP smoke: `GET /api/property-discoveries?marketKey=PHILADELPHIA_PA` reached the API and returned **401** with Clerk `dev-browser-missing` / signed-out. This verifies the auth gate, not an authenticated owner response. No legitimate owner browser session was available.

**Remaining blockers:** A rejected source-key identity conflict is not yet saved as a first-class review item with an owner decision and resolution audit; its candidate evidence therefore cannot be reconciled through the Sources UI. The persisted historical property snapshot is retained for audit, but should not be mistaken for a reviewed conflict resolution. No public-feed seller contact route, seller motivation, or lead readiness is implied by these property-intake results.

**Next single task:** Persist conflicting property-source identities into an owner-review queue, expose the exact conflicting IDs and provenance in Sources, and implement an audited resolution that preserves both source histories without silently repointing an observation.

## Block 6 buyer-disposition completion — 2026-10-14

**Status: implementation, synthetic persisted exercise, and the actual capability-protected HTTP download path passed; live owner/buyer proof remains PARTIAL, not GREEN.**

- Added `GET /api/portal/deal/download` to the existing buyer portal. It requires the existing capability token, reloads the persisted distribution and buyer, and rechecks current approval, dated funding/capacity evidence, and deal fit on every access. A buyer whose evidence becomes stale after invitation is denied both preview and download; rejected reads add no access event.
- The PDF is generated only from the buyer portal's redacted snapshot. The route returns `application/pdf`, attachment disposition, and `Cache-Control: no-store`; neither street address nor seller identity is included. Bearer-only sharing remains blocked for an address-disclosing packet. Portal views and downloads remain access evidence only—not delivery, buyer intent, acceptance, or commitment.
- Added the download control/error state to the existing buyer packet page. The dashboard buyer-readiness copy now distinguishes current real approved buyers from stale/unverified records and synthetic exclusions, and gives an exact next step when no current approved buyer exists. No matching, economics, offer authority, or commitment rules were relaxed.
- API contract regeneration passed (`pnpm --filter @workspace/api-spec run codegen`; generated clients/schemas and `typecheck:libs` completed). API and web typechecks passed. API build passed (9.0 MB bundled output). Web build passed with `PORT=5173 BASE_PATH=/radical-deal-os/`; existing sourcemap-resolution notices and the 1.08 MB main-chunk warning remain.
- `exercise:transactions` passed against its isolated persisted synthetic schema. It exercised valid HTTP `GET /api/portal/deal/download` (200, PDF content type and attachment header), street-address/seller-identity absence in the PDF, stale-after-invitation preview/download rejection, no event on rejected access, persisted access history for valid views/downloads, immutable economics snapshot, redaction/share blockers, buyer matching/funding/capacity, and commitment concurrency/authority invariants. Exercise outcome: **1 synthetic transaction, 0 real transactions**.
- `exercise:buyers` passed: create/reload, owner-only verification, dated funding, stale evidence, version conflict, identity invalidation, queued matching. `test:auth` passed **7/7**, `test:transaction-readiness` **5/5**, and `test:command-center` **15/15** (including current-approved versus stale/unverified/synthetic counts and authenticated-route denial). These are tests/exercises, not evidence of a real approved buyer.
- Both `artifacts/api-server: API Server` and `artifacts/radical-deal-os: web` were restarted successfully and report RUNNING. Local smoke checks: API download without token returned **400** with `{"error":"X-Portal-Token: Required"}`; web root returned **200**. The dev-domain curl from the shell could not connect, so local workflow ports were used. Browser screenshot showed the public sign-in page; no legitimate owner session or live buyer pool was available to verify authenticated UI/counts.
- Provider state remains `NOT_CONNECTED` / `NOT_SENT`; no live package delivery, buyer response, or commitment occurred. No genuine owner/browser session was available, and this turn did not read or claim a live buyer count. The signed-in dashboard will show the persisted live count when an authorized owner session is available.

**Next single task:** verify the persisted buyer count and owner-controlled redaction settings through a legitimate owner session. Until then, Block 6 remains operationally partial; do not claim a live buyer pool or GREEN status.

**Turn state:** implementation, persisted/API tests, builds, workflow restart, and local endpoint smoke completed; no background task is running.

## Block 7 seller contact acquisition — 2026-10-14

**Status: research/manual-capture behavior and command-center coverage are implemented and tested; live direct contact remains unavailable. No public source is represented as having a route.**

- Reused the existing owner-reviewed Sources contact-research case and manual candidate-route editor. Saved case evidence includes cited source/page, route/source record, permission basis and permission evidence, recipient identity/role/confidence, capture/observed time, freshness, verification, conflict state, and append-only audit. Exact replay is idempotent; version changes reject stale writes; prohibited/unknown permission, stale routes, unresolved recipient conflicts, and postal-only data stay blocked.
- Candidate routes remain separate from raw discovery contact paths until reviewed and promoted. Promotion transfers only current, permitted, verified seller routes; research itself creates no lead, call, outreach, or economic/offer change.
- Added a full-market persisted coverage summary to the property-discovery response and existing command-center panel. It separates source-feed routes from all routes, current permitted/verified routes from candidates, synthetic route candidates from non-synthetic counts, and reports stale, identity-conflicted, permission-blocked, identity/verification-incomplete, postal-only, and no-direct-route property totals with one next action. Counts are computed over the market pool, not just the loaded page.
- Real permitted-source result from `exercise:property-source`: **594** persisted unique discoveries, **0** phone/email/web routes, **0** raw-discovery-to-lead promotions, and **165** unmatched observations. No contact route was invented. The isolated exercise's synthetic route-transfer case remained visibly synthetic and did not change the live public-feed route count.
- `exercise:property-source` PASS: pagination-wide coverage totals matched the persisted pool; source-feed direct routes remained zero; synthetic candidates were separately counted; route transfer, exact replay, no duplicate audit, stale-version rejection, conflicting identities, 31-day stale route, owner/operator/viewer gates, persisted reload, and economics/lead-creation invariants passed.
- `exercise:property-contact-http` PASS: actual router path in an isolated schema returned 403 for viewer and operator permission approval, 200 for owner evidence capture/replay, and reloaded the saved route through a separate HTTP GET. Test identity middleware was synthetic; production auth was not bypassed.
- Exact checks: `pnpm --filter @workspace/api-spec run codegen` PASS (including `typecheck:libs`); `pnpm --filter @workspace/api-server run typecheck` PASS; `pnpm --filter @workspace/radical-deal-os run typecheck` PASS; API build PASS; `BASE_PATH=/radical-deal-os/ PORT=5173 pnpm --filter @workspace/radical-deal-os run build` PASS (existing sourcemap and >500 kB chunk warnings); `pnpm --filter @workspace/api-server run test:auth` **7/7**; `pnpm --filter @workspace/api-server run test:command-center` **15/15**; `pnpm --filter @workspace/deal-domain test` **105/105**.
- The command-center/API suite confirmed the real unauthenticated contact-research POST returns **401**; the isolated role exercise used fake identity middleware only to verify role boundaries. No owner browser session was available. No workflows were started or restarted, as explicitly requested; API/web UI was validated by typecheck/build and persisted HTTP exercises, not a live browser session.

**Next single task:** Block 8 — complete real buyer acquisition and re-verification, preserving the live/synthetic separation. Block 6's authenticated owner-session proof remains a separate unresolved operational blocker and must not be called complete.

**Turn state:** Block 7 implementation, persisted exercises, typechecks, builds, and domain/auth checks completed; workflows remain stopped.

## Block 8 buyer intake and re-verification — 2026-10-14

**Status: PARTIAL; do not mark GREEN.** Existing prospect separation, owner verification, buy-box/funding/capacity evidence, 30-day verification expiry/reverification, and buyer matching were reused. This turn adds route-duplicate conflict rejection, owner-only evidenced contact permission/opt-out capture, and fail-closed permission-aware outreach readiness. No buyer was approved or contacted by these tests.

- Manual create now takes an advisory lock on normalized email/phone keys. Exact duplicate routes return 409; a route on a different normalized identity also returns 409 with the existing record ID for manual review. No automatic merge occurs.
- Added owner-only `POST /buyers/{id}/contact-permission`. It persists grant/opt-out state, channel scope, source, evidence URL, capture time, expiry, reviewing owner, history, version change, and audit event. Grants require current evidence no older than 30 days and expire within 30 days. Opt-out suppresses all channels until a new reviewed permission record.
- Buyer detail UI can record a channel-specific grant or global opt-out. When a qualification task exists, its outreach panel displays permission status; saving permission does not send a message. Fresh buyer reads recompute readiness from the persisted permission record. A separate permission-history reader is not yet exposed.
- Buyer outreach readiness remains `DRAFT` / `NOT_SENT`; no provider is registered, so no queue/send/confirmation is claimed. Added a typed transition guard for DRAFT → APPROVED → QUEUED → SENT → CONFIRMED, with QUEUED/SENT failure branches; these transitions are unit-tested but are **not yet persisted as message-level records or connected to a provider**.
- Persisted synthetic `exercise:buyers` PASS: create/reload, owner-only buyer verification, date/funding evidence, stale verification, version conflict, identity invalidation, exact duplicate and conflicting route rejection, owner permission grant/opt-out reload, operator denial, stale version rejection, and expired consent rejection. The test schema contained only the labeled synthetic buyer.
- `exercise:buyer-pool` PASS: 112 observed prospects and 114 source observations in its isolated database; public observations remained prospects, no approval was inferred, and no communication was sent. The one-time qualification portal exercise passed replay/stale/replace/expiry and owner-review boundaries.
- `test:buyer-outreach` **3/3**; `test:auth` **7/7**; `test:command-center` **15/15**, including 401 for unauthenticated access to the new permission route; `pnpm --filter @workspace/deal-domain test` **105/105**.
- `pnpm --filter @workspace/api-spec run codegen` PASS (including library typecheck); API/web typechecks PASS; API build PASS; `BASE_PATH=/radical-deal-os/ PORT=5173 pnpm --filter @workspace/radical-deal-os run build` PASS (existing sourcemap and >500 kB chunk warnings).
- No provider is connected and no real buyer outreach, reply, funding review, or approval occurred. The HTTP permission route was verified unauthenticated (401); owner/operator behavior was verified in the persisted service exercise, not with a live owner session. Workflows remain stopped, and no signed-in browser test was run as requested.

**Next single task:** finish Block 8 with a reloadable consent-history view and persisted message-level drafts/approvals plus provider receipt transitions for QUEUED/SENT/CONFIRMED/FAILED, rechecking consent with idempotency and audit; keep the no-provider path DRAFT/NOT_SENT.

**Turn state:** Block 8 remains partial; isolated tests and builds passed; workflows were not started or restarted.

## Ordered implementation backlog Blocks 6–10 — 2026-10-14

**Backlog handling:** Kept as one ordered checkpoint sequence; no separate project tasks were created or claimed. Block 6 remains the first incomplete block.

### Block 6 — Finish buyer disposition gaps

**Status: PARTIAL for live operational proof.** Code/API acceptance now includes persisted owner-controlled redaction, current buyer requalification on each portal read, and a capability-protected redacted PDF download. The newer completion entry above records this turn's exact implementation and checks. Real buyer readiness is not claimed.

- Security boundary: the existing buyer portal uses bearer links and does not verify the reader's identity. Address-disclosing snapshots therefore cannot be shared through those links; the API rejects sharing and the portal strips the street address as defense in depth. This preserves the existing no-address-leak assertion instead of weakening it.
- Still open: actual owner-authenticated preference update and signed-in browser interaction were not verified; no live buyer pool/approved buyer evidence was obtained this turn. Bearer-only identity policy still blocks external address disclosure.
- Persisted synthetic verification: `exercise:transactions` now also tests the valid PDF HTTP route, redaction, stale-after-invite access denial, and access-event persistence; preference role denial/save-reload, immutable packet after preference change, address-disclosing share rejection, and commitment rules remain covered. It reports **0 real transactions**. `exercise:buyers` covers buyer create/reload, owner-only verification, dated funding, stale evidence, version conflict, identity invalidation and matching.
- Exact checks: `pnpm --filter @workspace/api-spec run codegen` PASS (includes library typecheck); `pnpm --filter @workspace/api-server run typecheck` PASS; `pnpm --filter @workspace/radical-deal-os run typecheck` PASS; `pnpm --filter @workspace/api-server run build` PASS (9.0 MB); `BASE_PATH=/radical-deal-os/ PORT=5173 pnpm --filter @workspace/radical-deal-os run build` PASS (existing sourcemap and >500 kB chunk warnings). `pnpm --filter @workspace/api-server run exercise:transactions` PASS; `pnpm --filter @workspace/api-server run exercise:buyers` PASS; `pnpm --filter @workspace/api-server run test:auth` **7/7**; `pnpm --filter @workspace/api-server run test:transaction-readiness` **5/5**; `pnpm --filter @workspace/api-server run test:command-center` **15/15**.
- Runtime: API and web workflows restarted and running; unauthenticated `GET /api/distribution-preferences` returned **401**; web root returned **200**. Screenshot showed the public sign-in page. No legitimate signed-in owner session was available, so authenticated UI behavior remains unverified.

### Block 7 — Seller contact route acquisition path

**Status: implemented and verified for code/API acceptance; no live direct route exists.** The owner-reviewed pre-promotion case and transfer gate are reused; command-center coverage reports live feed route counts and blockers across the persisted pool. The permitted live source sample remains 594 discoveries and zero direct phone/email/web routes. See the Block 7 checkpoint above for exact tests and limitations.

### Block 8 — Real buyer acquisition and re-verification

**Status: PARTIAL.** See the Block 8 checkpoint above. Consent capture and duplicate-route conflict rejection are persisted/tested; message-level outreach state and provider-confirmed delivery remain incomplete. No provider is connected and no outreach was sent.

### Block 9 — End-to-end deal package and distribution control

**Status: PARTIAL; code/service acceptance verified, but no live distribution or provider delivery is proven.** Existing owner-authorized, versioned economics packets, address redaction, private bearer links, buyer intent history, and owner-reviewed commitment handling were retained. New server-side snapshot checks reject link creation and portal access when current executed price/assignment/deadline/contingencies, communicated offer authority, underwriting snapshot, or economics hash no longer match the frozen packet. Stale portal reads do not create access events. The existing UI explicitly says links are copied manually and the system has not sent a notification.

**Verified on 2026-10-14**
- `pnpm --filter @workspace/api-server run exercise:transactions` **PASS** against the isolated persisted synthetic schema. Exercise reports **1 synthetic transaction, 0 real transactions**. Added persisted stale-contract-price rejection and verified it records no successful portal-access event; restored the synthetic contract row after the assertion. Existing assertions cover redacted packet/PDF disclosure, immutable economics hash, stale buyer verification, exact portal-response replay and conflicting replay rejection, role gates, intent versus commitment, and concurrent first-valid commitment handling.
- `pnpm --filter @workspace/deal-domain test` **105/105 PASS**; `pnpm --filter @workspace/api-server run test:auth` **7/7 PASS**; `pnpm --filter @workspace/api-server run test:transaction-readiness` **5/5 PASS**.
- API typecheck and build **PASS**. Web typecheck **PASS**. Web build **PASS** with `PORT=5000 BASE_PATH=/radical-deal-os/ pnpm --filter @workspace/radical-deal-os run build`; existing sourcemap-location and >500 kB chunk warnings remain. The first web-build attempts without all required environment variables failed as expected; the fully configured build passed.
- The persisted exercise reports **delivery provider NOT_CONNECTED / delivery NOT_SENT**. No real approved buyer/deal, actual provider receipt, sent package, or buyer commitment is claimed. Workflows were not restarted; no live HTTP smoke test or signed-in browser test was performed.

**Next single task:** finish Block 8's persisted buyer-message approval/receipt lifecycle and consent-history view, preserving the no-provider DRAFT/NOT_SENT path. Keep Block 9 marked PARTIAL until a legitimate provider-confirmed delivery and real eligible buyer/deal path can be exercised.

### Block 10 — Operator-ready daily command center and transaction control

**Status: PARTIAL; implementation and persisted acceptance passed, signed-in owner UI remains unverified.** The existing authenticated command center retains the ranked persisted next action, due work, blocked contact research and CALL NEXT gates, underwriting gaps, current buyer verification, transaction milestones, deadlines, exceptions, provider connectivity, persisted worker/source-refresh states, and the existing outcome-learning panel. Added a package-readiness card for active executed contracts. It reads each deal's persisted distribution endpoint and distinguishes no authorized packet, blocked contract, authorized immutable terms, redaction, eligible current buyer matches, recipient records, and expiry. It shows NOT_SENT when delivery is not connected; connection alone never counts as a recipient receipt. No fake refresh/send/sign/funds controls were added.

**Verified on 2026-10-14**
- `pnpm --filter @workspace/api-server run test:command-center` **17/17 PASS**, including API unauthenticated 401 checks, cached-private-data denial, command action/call de-duplication, route gates, and tests that links cannot be represented as sent/confirmed without provider/receipt evidence.
- Persisted exercises **PASS**: `exercise:command-center` (empty and populated isolated state; current/overdue/failed jobs, source permission/recurrence, role-assigned actions, human gates); `exercise:acquisition-queue` (synthetic true; persisted CALL NEXT gates, call notes/evidence and stale underwriting); `exercise:research-lifecycle` (6 cases; terminal-race regression, mocked providers only); `exercise:transactions` (isolated schema, **1 synthetic / 0 real** transactions, persisted milestones/exceptions, delivery provider **NOT_CONNECTED / NOT_SENT**); and `exercise:outcome-learning` (isolated synthetic records, idempotent actuals replay, stale snapshot rejection, no live rule change).
- `test:outcome-learning` **2/2 PASS**; `test:auth` **7/7 PASS**; `pnpm --filter @workspace/deal-domain test` **105/105 PASS**. API and web typechecks **PASS**; API build **PASS**; web build **PASS** with `PORT=5000 BASE_PATH=/radical-deal-os/`. Existing sourcemap and >500 kB chunk warnings remain.
- Signed-in browser verification was not performed: no legitimate owner session was available and the workflows were not restarted as requested. The 401 route tests verify denial without a session; they do not verify owner-rendered UI, owner/operator rendering, or live HTTP behavior in a running workflow. No live seller/buyer action or external receipt is claimed.

**Next single task:** verify the authenticated command center with a legitimate owner session when available. Separately retain Block 8 message-level delivery receipts and Block 6 live owner proof as unresolved backlog; do not mark them complete from synthetic evidence.

**Turn state:** Block 10 package-readiness UI, truthful delivery display, tests, builds, and persisted exercises completed. Workflows remain stopped. No live buyer approval, external delivery, or transaction is claimed.

### Block 11 — Contract readiness, signatures, and deadline control

**Status: PARTIAL; tracker and persisted synthetic acceptance passed, but live contract execution is not proven.** Added a stage tracker to the existing deal operations panel showing locked seller offer terms and transaction version; whether an owner-reviewed buyer commitment exists; jurisdiction-template review readiness; current review-copy state; signature-provider connectivity and whether a signature request was actually sent; seller/acquisition signature evidence; earnest-money amount and evidence; and owner-reviewed closing-deadline schedule. The tracker distinguishes a prepared review worksheet from a legal document, and evidence on file from a completed external action. Special clauses remain review-only; no approval or insertion is inferred.

**Verified on 2026-10-14**
- `pnpm --filter @workspace/api-server run exercise:transactions` **PASS** against the isolated synthetic schema: **1 synthetic / 0 real** transactions. Existing assertions cover owner authorization, exact immutable offer/economics snapshot, stale/version changes, document lifecycle and audit, independently recorded signatures, EMD amount/source evidence, schedule term hashes and deadline calculations, and terminal exception handling. One retry-safe synthetic `MATCH_BUYERS` worker-failure warning was emitted; the full exercise completed successfully. Readiness reported signing provider **NOT_CONNECTED**; no signature request, signature, deposit, or closing is claimed.
- `pnpm --filter @workspace/api-server run test:transaction-readiness` **5/5 PASS**, covering deadline boundaries/time zones, replay hashes, material-term staleness, and complete milestone schedules.
- `pnpm --filter @workspace/api-server run exercise:clause-review` **PASS** (synthetic only): idempotent replay; missing approved template blocks; qualified review remains NOT_REVIEWED; no automatic insertion; owner-only checks; jurisdiction mismatch rejected; one audit event; deal unchanged.
- `pnpm --filter @workspace/api-server run test:auth` **7/7 PASS**; `pnpm --filter @workspace/deal-domain test` **105/105 PASS**. API/web typechecks and builds **PASS**. Existing API bundle-size, web sourcemap-location, and >500 kB chunk warnings remain.
- Workflows were not restarted. No authenticated owner/operator browser verification or running-workflow HTTP smoke was performed. No real approved transaction, legal approval, signature-provider receipt, signature, earnest-money transfer, or closing evidence was available in the exercise.

**Next single task:** verify the contract-readiness tracker in an authenticated owner session against a legitimate current transaction; keep provider-dependent signature sending blocked until a supported provider and its receipts are available.

### Block 12 — Closing operations, outcomes, and end-to-end proof

**Status: PARTIAL; existing persisted closing/outcome services are exercised, and the deal page now has a unified lifecycle timeline and next-action summary. It is not full end-to-end proof.** The timeline assembles persisted stage transitions, seller call records, buyer match states, destination activity, contract history, prepared documents, deadline schedules, closing milestones, and recorded outcomes. It displays the single work-guidance action with responsibility, due time, and missing-fact blockers. It labels call notes and buyer responses as non-verifying, marks transaction milestone references as operator-recorded, and does not describe document preparation as sending/signing or an operator-entered closing outcome as provider-verified. The coverage summary includes acquisition stage, underwriting snapshot presence, seller call records, eligible buyer matches, distribution event count, contract/funds milestones, closing outcome state, and the no-automatic-economics-change rule. The exercises ran against separate isolated synthetic schemas; none followed one deal continuously from a permitted seller route through verified settlement and post-deal learning.

**Verified on 2026-10-14**
- `pnpm --filter @workspace/api-server run test:command-center` **17/17 PASS**; `exercise:command-center` **PASS** against an isolated persisted synthetic workspace, covering role-assigned next actions and current/overdue/failed jobs.
- `pnpm --filter @workspace/api-server run exercise:transactions` **PASS** against an isolated synthetic schema (**1 synthetic / 0 real**). It covers versioned contract/document states, stale economics/party snapshots, signatures, EMD/funds evidence, deadlines/exceptions, cancellation, and audit. A retry-safe synthetic `MATCH_BUYERS` worker-failure warning appeared; the complete exercise passed.
- `pnpm --filter @workspace/api-server run test:transaction-readiness` **5/5 PASS**; `exercise:outcome-learning` **PASS** with synthetic-only outcomes excluded from real counts and `noLiveRuleChange: true`; `test:outcome-learning` **2/2 PASS**.
- `pnpm --filter @workspace/api-server run test:auth` **7/7 PASS**; deal-domain tests **105/105 PASS**. API/web typechecks and builds **PASS**. Existing API bundle-size, web sourcemap-location, and >500 kB chunk warnings remain.
- No workflows were restarted. The API tests verified unauthenticated denial (401), not signed-in owner access. No real deal/outcome, verified title/settlement receipt, provider-confirmed delivery/signature, or owner browser session was exercised.

**Remaining blockers:** current source/contact-route evidence and open readiness-exception records are not merged into this chronological feed; the route gate remains authoritative and call notes do not prove a permitted route. No live provider or real closing evidence exists. Outcome-learning exercises are synthetic and do not establish real-world calibration.

**Next single task:** join persisted source/contact-route provenance and current readiness exceptions into this per-deal timeline, preserving the route gate, then verify the authenticated owner view when a legitimate owner session is available.

### Block 13 — Real provider integrations and connection health

**Status: PARTIAL; provider-neutral status boundaries, UI, and tests are implemented. No external provider is connected or claimed live.** Extended the authenticated transaction-readiness response with provider-health entries surfaced in the existing command-center dashboard for permitted property sources, contact research, email/SMS, document/signature, closing coordination, and private storage. Health is derived from registered adapters, persisted source-job outcomes, and existing readiness checks. Source success older than 12 hours is DEGRADED; the response labels each check type and timestamp and preserves prior successful source-job time. It maps 401/403 to DISCONNECTED, 429/rate-limit errors to RATE_LIMITED, other failures or missing source probes to DEGRADED, and absent providers to UNCONFIGURED. Readiness/configuration checks are explicitly not described as live network probes. No credential values are read or returned. No outbound action or paid dependency was added.

**Verified on 2026-10-14**
- `pnpm --filter @workspace/api-spec run codegen` **PASS**, including generated API/Zod clients and workspace library typecheck.
- `pnpm --filter @workspace/api-server run test:provider-health` **3/3 PASS** for connected, disconnected, degraded, rate-limited, queued/retry, unconfigured, stale success, prior-success retention, and credential-value redaction.
- `pnpm --filter @workspace/api-server run exercise:command-center` **PASS** against isolated synthetic persistence; it asserts provider-health statuses and safe non-secret output.
- `pnpm --filter @workspace/api-server run test:command-center` **17/17 PASS**; `test:auth` **7/7 PASS**; `test:research` **3/3 PASS**; `test:buyer-outreach` **3/3 PASS**; signing-provider test **1/1 PASS**. `exercise:property-contact-http` **PASS** on an isolated synthetic property, with fake identity middleware only.
- API/web typechecks and builds **PASS**. Existing API bundle-size, web sourcemap-location, and >500 kB chunk warnings remain.
- Safe live check: unauthenticated `GET /api/operations/transaction-readiness` returned **401**. No owner session was available to inspect authenticated provider status. No external health probe or delivery/signature/closing request was made. The workspace had no third-party integrations attached in the available integration state; provider credentials were not inspected.

**Remaining blockers:** real connectivity, live source freshness, provider-specific rate limits, retries, delivery receipts, signature receipts, and close/settlement provider events remain unverified until an owner selects and connects a provider. Manual contact capture and closing workflows remain available; they are not provider connections.

**Next single task:** connect one owner-selected provider for a non-live capability test, then verify its authenticated health and idempotent receipt path before enabling any real external action.

## Seller contactability milestone verification — 2026-10-14

**Status: service-level milestone verified; authenticated browser/owner-role HTTP verification remains unavailable. This does not make any real lead CALL READY.**

- Preserved and completed the contact-research candidate-route path: validated phone/email/web formats and HTTPS provenance; owner-only permission and route confirmation; seller identity evidence/confidence; 30-day freshness; deduplication and exact replay; stale-version rejection; conflict visibility; route audit metadata without storing the route value in audit prose; and promotion filtering so only current, permitted, owner-confirmed seller routes transfer.
- The persisted isolated `exercise:property-source` passed. It proved exact candidate replay adds no route/audit event, stale versions reject, operator permission approval rejects, conflicting recipients remain blocked, stale routes remain blocked, only the eligible synthetic route transfers, the lead contact reader reloads it as `PHONE_ROUTE_AVAILABLE`, postal-only lead readiness fails closed, and contact research creates no asking price, analysis, or offers. The fixture is explicitly synthetic.
- Live permitted-source evidence in the same exercise: **594** persisted discoveries, **0** raw-discovery-to-lead promotions, **165** unmatched observations, and **0** PHONE/EMAIL/WEB routes from permitted feeds. No real direct seller route was found or invented.
- Verification: API-spec codegen passed; API and web typechecks passed; API build passed; web build passed with existing sourcemap and chunk-size warnings; deal-domain tests **105/105** passed; auth tests **7/7** passed; command-center/API/UI tests **15/15** passed, including HTTP unauthenticated contact-research POST returning 401. The API/web workflows restarted and became ready. Runtime smoke: web `/` returned 200; unauthenticated contact-research returned 401.
- Browser limitation: no legitimate signed-in owner session was available. No auth bypass was attempted; authenticated Sources UI and owner-authorized HTTP save were not browser-verified. The exercise validated owner/operator service policy and persisted reload in the isolated test schema.

**Next ordered work:** the current request names Blocks 6–10 as five distinct connected work packages. Block 6 (source-refresh operations and reliability) is next; Blocks 7–10 are not implemented or verified in this entry. Do not infer completion from this checkpoint.

**Turn state:** Block 6 is in progress, not complete. The current turn also ran existing isolated exercises related to Blocks 7–10 for baseline evidence; those runs do not constitute implementation or completion.

## Block 6 — Source-refresh operations and reliability — 2026-10-14

**Acceptance criteria:** persisted jobs distinguish queued/running/succeeded/partial/failed; source freshness, last success/error, bounded retry/backoff, idempotent pagination continuation and duplicate-safe upserts are visible and tested through the real API/job path.

**Actual status: partial implementation; not GREEN.**

- Added `PARTIAL` to the persisted worker-job API state and the Workers page. Property discovery with source-specific failures now completes as `PARTIAL`, not `SUCCEEDED`; no successful connector set still throws and becomes `FAILED`. The message retains per-source failure details.
- Focused state-mapping test passed **1/1**. Persisted `exercise:property-source` passed the actual terms-reviewed `DISCOVER_PROPERTIES` job path and source refresh, reporting **594** persisted unique discoveries, **0** raw-discovery promotions, **165** unmatched observations, **24** pages, and no permitted direct PHONE/EMAIL/WEB routes. Existing pagination, source-level dedupe, and refresh behavior remained intact.
- API-spec codegen, API/web typechecks and API/web builds passed. Domain tests passed **105/105**, auth **7/7**, command-center/API/UI **15/15**. Workflows restarted; API unauthenticated contact-research POST and command-center GET returned **401**; web root returned **200**. All three workflows reported running.
- **Still unmet:** per-source durable last-success/last-error freshness history; bounded automatic retry/backoff for property refresh; resumable continuation from a partial traversal; and a persisted test that drives a partial source failure through `runWorkerOnce` and reloads the stored `PARTIAL` result. Current retry is an operator-queued retry, not automatic backoff. No real source refresh job was submitted through an authenticated owner browser session.

## Block 7 — Human-minimal communications center — 2026-10-14

**Acceptance criteria:** provider-neutral draft/approval/queue/delivery states and receipts, idempotency, contact permission/consent, opt-out, rate limits, role gates, audit trail, and a copy-ready manual fallback explicitly marked not sent.

**Actual status: existing manual handoff baseline exercised; requested provider-backed communications work is not complete.**

- Existing `exercise:handoffs` passed persisted handoff preparation, permission guard, actual-versus-recorded events, concurrent event recording, non-qualifying replies, audit rollback, retry, stale/terminal handling, recurring idempotency and lease recovery. Fixtures are synthetic; no message was sent.
- No email/SMS provider is connected in this workspace. No provider receipt or sent/confirmed state was created, and no provider integration or new communications UI was added in this turn. Human approval, consent/opt-out and delivery receipts still need an end-to-end implementation and tests.

## Block 8 — Deal package readiness and controlled distribution — 2026-10-14

**Acceptance criteria:** immutable versioned packages tied to evidence/underwriting, configurable redaction, current approved buyer-specific access, explicit blockers, real delivery receipts/access logs/expiry/revocation, and concurrency-safe commitments.

**Actual status: existing buyer and seller portals were exercised; controlled buyer-package distribution is not complete.**

- `exercise:buyer-pool` passed the persisted one-time qualification link, owner gate, criteria carry-forward, replay/stale/replace/expiry, and no-auto-approval checks; it observed **112** source-derived prospects and **114** observations inside its isolated exercise and sent no communication.
- `exercise:seller-offer-portal` passed seller authority-bound response, secrecy, challenge, expiry/rotation/revocation, exact communicated snapshot, replay/rate-limit and no-contract/signature checks. This is not evidence that buyer-specific deal package delivery exists.
- Immutable buyer package snapshots, configurable address redaction, buyer access logs/expiration/revocation, confirmed package delivery, and commitment-race handling remain unimplemented/unverified here.

## Block 9 — Transaction operating desk and deadline exception automation — 2026-10-14

**Acceptance criteria:** versioned contract/party/term snapshots; provider-evidenced signatures and funds; dated title/inspection/EMD/buyer-fund milestones; deduplicated severity/deadline exceptions; stale-document/package blocking; authorized idempotent reminders; no invented legal or execution state.

**Actual status: existing transaction lifecycle exercise passed; no new transaction-desk changes were made in this turn.**

- `exercise:transactions` passed its isolated persisted lifecycle checks for protected documents, missing template/storage/signing-provider blockers, stale-document/economics behavior, parties/terms, EMD/funds mismatch, owner-only evidence, deadline schedules, idempotent reevaluation, evidence resolution and terminal cleanup. It reported **0** real transactions and **0** terminal open exceptions.
- Signing provider remains `NOT_CONNECTED`; delivery provider remains unconfirmed/not sent. This does not prove provider signature, fund transfer, or live closing.
- Any additional transaction desk UI/exception presentation or authorized reminder behavior beyond those existing exercised paths remains unverified.

## Block 10 — Closed-loop outcome learning and operations dashboard — 2026-10-14

**Acceptance criteria:** provenance-linked immutable outcome snapshots, observed and recorded times separated, real/synthetic distinction, prediction-versus-actual comparisons, evidence-backed versioned recommendations that cannot alter economics/authority, and a persisted operational dashboard over funnel, stale sources, contactability, buyer verification and exceptions.

**Actual status: existing outcome-learning persistence was exercised; requested dashboard scope is not complete.**

- `exercise:outcome-learning` passed in an isolated schema: four projected source events; replay inserted zero duplicates; occurred/recorded timestamps remained distinct; actual-vs-predicted ARV delta was **−$5,000** and repairs delta **$0**; stale snapshots rejected; synthetic rows excluded from real counts; no live rule change; one canonical reevaluation job.
- No new dashboard or live outcome-learning capability was implemented in this turn. The complete operational dashboard metric set, versioned recommendations visible to operators, cross-deal isolation and UI tests remain acceptance gaps.

**Historical turn boundary:** At that checkpoint Block 6 was the active incomplete package and Blocks 7–10 were baseline-only. The later ordered Blocks 1–5 section below supersedes its resume priority; the current first incomplete package is Block 4.

## Ordered implementation backlog Blocks 1–5 — 2026-10-14

### Block 1 — Real seller contactability

**Status: COMPLETE for code/service/API acceptance; live CALL NEXT remains correctly blocked because no real permitted direct route exists.**

- Added an isolated HTTP exercise using the actual property-source router, real route-role middleware, and real persistence/service handlers. Only the test harness’s outer authentication/membership middleware supplies a synthetic actor; production auth remains unchanged.
- HTTP exercise passed: viewer POST denied **403**; owner permitted-and-confirmed route save **200**; operator attempt to approve permission denied **403**; exact HTTP replay did not duplicate the route or audit entry; a separate HTTP list request reloaded the persisted candidate route.
- Persisted contact and source exercises passed provenance, route-format/permission/identity/freshness gates, postal-only/stale/conflict/unverified blocking, dedupe/replay/stale-version handling, safe lead transfer, and economics/offer-authority invariants. Synthetic contact evidence stayed separate from live source evidence.
- Live permitted-source exercise observed **594** persisted unique discoveries, **0** raw-to-active-lead promotions, **165** unmatched observations and **24** property pages. It found **0** direct PHONE/EMAIL/WEB routes. No public feed is claimed to have seller contact routes; no fabricated lead, contact, motivation, call, or outreach was added.
- Verification: domain **105/105**; auth **7/7**; command-center/API/UI **15/15**; property ranking **2/2**; API/web typechecks and builds passed. API restarted and reported listening; production unauthenticated contact-research POST returned **401**, web root **200**; all three configured workflows were running.
- Browser verification as a signed-in owner remains unavailable. This does not weaken the route gates; a legitimate current contact route is still required before any real seller can be CALL NEXT.

### Block 2 — Connected acquisition workbench

**Status: COMPLETE for persisted service/API/UI acceptance; no real seller is CALL NEXT because current permitted feeds have no direct route.**

**Acceptance criteria:** source-backed discovery remains separate from active leads; one command-center path exposes qualification/contact blockers, persisted underwriting readiness, verified-route-gated CALL NEXT ranking, call brief, notes saved and reloaded for the correct lead, seller-fact reconciliation/conflicts, stale-analysis/document propagation, and one truthful next action. Synthetic evidence must remain labeled and no missing contact/economics may be fabricated.

**Evidence:** `exercise:property-source` passed with 594 live source-backed discoveries, 0 raw-discovery promotions and zero direct routes; `exercise:acquisition-queue` passed current-route CALL NEXT, brief, blocked postal/no-route/stale/conflicting cases, underwriting blockers, persisted note reload against the owning lead, linked indicated seller-answer evidence, conflict review, stale analysis/offer-authority invalidation, and refresh of underwriting questions. Seller answers remain evidence and are not copied into property facts or economics. `exercise:command-center` passed persisted next-action, worker, consent and authority gates. Synthetic exercises are explicitly marked; no call was made.

**Checks:** domain suite **105/105**, auth **7/7**, command-center/API/UI **15/15**, property-discovery ranking **2/2**, API/web typechecks passed. These tests use isolated synthetic transactions except the property source observations explicitly labeled live.

### Block 3 — Deterministic underwriting

**Status: COMPLETE for deterministic calculation, persisted provenance, role/authority and stale-evidence acceptance; live deal assumptions still require real evidence.**

**Acceptance criteria:** evidence-backed comps/ARV and repair ranges, explicit holding/transaction costs and assumptions, deterministic MAO/opening/authorized-max/assignment/buyer economics, explainable risk and Strong/Negotiable/Pass status; missing inputs stay gaps; LLM/playbook guidance cannot mutate economics or authority; stale inputs and non-economic invariance are tested.

**Evidence:** `exercise:repair-estimate` passed source-bound inspected repairs vs separately labeled AI hypotheses, exact current-rate multiplication, no hypothesis propagation into MAO, immutable rate history and audit. `exercise:seller` passed persisted deterministic snapshot, provenance rejection, stale/concurrent-write rejection and analysis invalidation. `exercise:offers` passed MAO/authority/expiry guards, owner-only approval, concurrency conflict, exact communicated terms, and stale snapshot invalidation. `exercise:acquisition-queue` passed seller evidence conflict handling and stale underwriting/offer-authority invalidation. `exercise:seller-contact-enrichment` passed **12** synthetic requests and verified contact research preserves economics, authority, stage and next action; live registry remains unavailable. Deal-domain suite passed **105/105**, including deterministic formula/range, missing-input, freshness and hypothesis-exclusion cases.

### Block 4 — Verified buyer intake and disposition

**Status: PARTIAL; buyer evidence, explainable matching, frozen redacted packet, and truthful manual distribution are exercised, but live approved-buyer readiness and a configurable address-redaction choice remain unverified/unimplemented.**

**Acceptance criteria:** extend the existing buyer store with provenance-backed buy boxes, funding/capacity, consent, role/audit, freshness/reverification, duplicate/replay safety and explainable match/exclusion reasons; packages bind to current immutable evidence/economics snapshots, redaction settings and truthful distribution state; no current approved buyers means a precise qualification next step.

**Evidence:** `exercise:buyers` passed create/reload, owner-only verification, dated funding, stale evidence, version conflict, identity invalidation and queued matching. `exercise:buyer-pool` passed persisted one-time intake response, carry-forward, stale/replay/expiry, no automatic approval, and source/entity dedupe across **112** synthetic-schema prospects / **114** observations; it sent no outreach. Deal-domain tests passed explainable location/budget/rehab/funding/capacity exclusions and require current evidence. The persisted transaction/distribution exercise passed immutable economics hash, redacted packet, current-match checks, owner authorization, recipient capability/access records, stale snapshot rejection, buyer intent separate from commitment, and commitment-winner/concurrency controls. UI/manual link flow explicitly says no email/message was sent.

**Still open:** packet address is always redacted, but there is no explicit owner-configurable redaction setting; no production provider receipt exists; the live workspace buyer pool and signed-in buyer-intake UI were not verified in an owner browser, so no live approved/current buyer is claimed. Resume these before marking Block 4 complete.

### Block 5 — Transaction execution and deadline control

**Status: COMPLETE for the provider-unavailable persisted synthetic path and fail-closed controls; no real signature, message delivery, funds transfer, or closing is claimed.**

**Acceptance criteria:** current jurisdiction/version-compatible templates, review-only special clauses, immutable prepared-document snapshots, immediate stale/send/sign/download blocks after material changes, authorized communication states, provider-evidenced signature/funds/EMD/title/inspection/deadline/closing/outcome, deduplicated exceptions, and binding legal/financial approvals. Provider-unavailable manual actions must be labeled not sent/not signed/not completed.

**Evidence:** isolated `exercise:transactions` passed the persisted lifecycle, protected document storage, stale-document/economics blocking, owner-only financial evidence, EMD/funds mismatch, deadline schedule and exception resolution; it reported **0 real transactions**. Readiness explicitly returned signing provider `NOT_CONNECTED` and delivery provider `NOT_CONNECTED / NOT_SENT`; no external send/sign is asserted. `test:transaction-readiness` passed **5/5**. `exercise:clause-review` passed synthetic idempotency, owner-only and jurisdiction mismatch checks, with missing approved template blocking auto-insertion. `exercise:seller-offer-portal` passed the owner-authority-bound seller-response lifecycle with no actual seller or communication. The persisted outcome-learning exercise passed synthetic provenance/time separation, replay, stale snapshot rejection, synthetic exclusion, and no-live-rule-change checks.

**Checks:** API/web typechecks and builds passed; domain **105/105**, auth **7/7**, command-center/API/UI **15/15**. API restarted and production unauthenticated contact-research POST returned **401**; web root returned **200**. Workflows report running. All transaction and outcome records cited here are synthetic isolated-schema fixtures.

**Backlog resume point:** Block 4 is the first incomplete package. Complete the owner-configurable address-redaction choice and verify the actual live approved/current buyer state (or the precise no-buyer next action) before treating the five-block backlog as fully complete. Do not imply a real buyer was approved or a packet delivered.

## Contact-research case and buyer-readiness handoff — 2026-10-13

**Status: persisted discovery-contact workflow implemented and synthetic behavior exercised; direct-route capture on an unpromoted discovery and authenticated browser use remain incomplete.**

- Added a versioned `contactResearchCase` to the existing property-discovery payload/response, with status, confidence, source name/type/reference, observed-at, identity-match state, permission basis, evidence reference, note, missing requirements, next action, up to 50 audit entries, and explicit synthetic labeling. No parallel contact table was introduced.
- Added an owner/operator/analyst endpoint to save the case. It checks discovery version under row lock, rejects promoted properties (those use the existing lead contact-evidence workflow), validates source URLs/timestamps, records audit history, and treats an exact replay as idempotent. Stale research renders as `NEEDS_REVIEW`. Recorded-owner evidence is explicitly not seller identity/signing authority; unknown/prohibited permission and absent verified direct phone remain blockers.
- Added the case editor and persisted case summary inside the existing Sources qualification detail. It routes actual direct-route evidence through the existing promoted-lead Contact Evidence panel; this case records research metadata only. It cannot create a contact route, lead, call, buyer match, or economics change.
- Reused buyer intake, qualification, current-verification, and matching rather than creating a second buyer system. Existing Buyer page captures structured criteria; owner verification requires dated identity/current-buying/criteria/funding evidence, expires within 30 days, and only current approved records are match-eligible. Command Center already links to buyer evidence/intake and separates current, stale, unverified, and synthetic counts.

**Verification completed:**
- `pnpm --filter @workspace/api-spec run codegen` — passed; generated workspace library typechecks passed.
- API and web `typecheck` — passed.
- `pnpm --filter @workspace/api-server run test:property-discovery-ranking` — 2/2 passed.
- `pnpm --filter @workspace/api-server run test:auth` — 7/7 passed.
- `pnpm --filter @workspace/api-server run test:command-center` — 15/15 passed.
- API and web builds — passed. Existing web sourcemap-resolution and >500 kB chunk warnings remain.
- `pnpm --filter @workspace/api-server run exercise:property-source` — passed in an isolated persisted schema, including synthetic case save/reload, owner-only access rule, stale-version rejection, exact replay without duplicate audit, no route creation, and no promotion. The same exercise used live permitted public records: 594 unique OPA discoveries, zero raw-to-active-lead promotions, 165 unmatched observations; L&I violations 96, unsafe buildings 87, vacancy 87, permits 90, demolitions 104, sheriff deeds 730 observations/651 source records across 17 pages. It found zero persisted POSTAL/PHONE/EMAIL/WEB/OTHER routes in that exercise.
- `pnpm --filter @workspace/api-server run exercise:buyer-pool` — passed in isolated PostgreSQL: 112 source-derived prospect observations/114 source observations, no real workspace prospects seeded, no outreach sent, and no inferred approval.
- `pnpm --filter @workspace/api-server run exercise:buyers` — passed with synthetic records for create/reload, owner-only verification, dated funding, stale evidence, version conflicts and identity invalidation.

**Boundaries / not GREEN for live operations:** The contact-research case records the search/review state, not a phone/email value. Direct-route evidence is entered only after a discovery is qualified/promoted, through the already-existing lead evidence form; attaching a verified direct route before promotion is still unsupported. This avoids turning a raw discovery into a lead, but means the user's desired full pre-promotion contact-enrichment handoff is partial. No real approved/current buyer or seller contact route was established. The preview screenshot remains the public sign-in page; no legitimate authenticated owner session was available, so signed-in browser workflow was not verified. Buyer exercises are synthetic/isolated; source-prospect observations in the exercise are not real approved buyers. No outreach, underwriting change, offer, signature, funds, or closing was claimed.

**Runtime:** API, web and component-preview workflows are RUNNING after restart; API logged `Server listening`, and Vite logged ready. The app is not GREEN for end-to-end live deal flow.

**Next concrete blocker:** Support provenance-backed direct-route evidence on a discovery and carry it safely into the existing lead contact model only after human qualification/promotion, with the same owner permission and fail-closed CALL NEXT gates. No live direct seller contact route is currently available from the exercised feeds.

**Turn state:** implementation and checks completed; no background Agent task is running.

## Live discovery visibility in the command center — 2026-10-13

**Status: persisted-source UI path implemented and build-tested; authenticated screen is not browser-verified.**

- The authenticated dashboard now queries the persisted Philadelphia discovery endpoint directly in bounded pages, surfaces the status counts and the highest-ranked first five results, and links to the existing full paginated Sources page. Each row exposes qualification state, score/confidence, reason, blocker/next action, source name/ID/reference, classification/confidence and last-observed time. It labels only the previously exercised Philadelphia source IDs as live, explicit synthetic/test/fixture IDs as synthetic, and any other or absent provenance as unverified. It does not use dashboard fixtures.
- CALL NEXT navigation is withheld unless the discovery is already server-marked `CALL_READY` and has a current, verified, permitted phone route with explicit `SUPPORTS_ALLOWED` evidence. Postal-only, missing, stale, unpermitted, unverified, or email/web-only paths remain blocked from the call link. No-route guidance says to pursue permitted owner/contact research or record legitimate evidence; it does not claim research or outreach occurred.
- Current persisted underwriting is displayed only when linked to the property, with expected ARV/repair/MAO, calculation time, repair-catalog version, comp-age/minimum assumptions, holding and contingency assumptions, plus blockers/risks. It states that no current analysis is available otherwise.
- “Refresh desk” now refreshes command-center, transaction-readiness, and discovery queries. The existing successful call-note mutation invalidates lead, command-center, acquisition-queue, audit, and discovery queries so the next action refreshes after persisted seller answers.
- Added six UI-state helper tests for 401/403 and stale/empty behavior, source-versus-synthetic/unknown labels, and fail-closed contact readiness. Existing persisted property-source and acquisition-queue exercises passed: raw records were not automatically promoted; synthetic call-note evidence persisted and reevaluation occurred. API anonymous HTTP requests to `/api/property-discoveries` and `/api/acquisition-queue` both returned 401.

**Checks:** web typecheck passed; command-center helper tests 6/6 passed; web build passed with existing sourcemap and >500 kB chunk warnings. API typecheck, auth tests 7/7, and API build passed. The live-source property exercise passed with 594 unique OPA discoveries, zero raw-to-active-lead promotions, and 165 unmatched observations; existing exercise source counts are in the preceding checkpoint section. The acquisition-queue persisted synthetic exercise passed. A first web build attempt without required `PORT` failed; rerun with `PORT=20639 BASE_PATH=/` passed. A first root-level `pnpm exec tsx` invocation could not find the binary; rerun through the API-server workspace passed all six tests.

**Browser/auth limit:** the preview screenshot rendered the public sign-in landing page. The browser had no legitimate signed-in owner session, so no authenticated command-center screen or live signed-in interaction was verified. No auth bypass was attempted.

**Workflow state:** web and API workflows are RUNNING; web logged Vite ready and API logged `Server listening`. Mockup sandbox is NOT_STARTED and was not needed.

**Next milestone:** signed-in owner browser verification of the live discovery panel and call-note refresh, using a legitimate session. After that, prioritize freshness-aware source refresh/coverage only where permitted access is actually available. No real CALL NEXT seller is currently proven because the exercised sources have no direct seller phone/email/web routes.

**Turn state:** implementation and checks completed; no background Agent task is running.

## Command-center discovery controls and source-refresh handoff — 2026-10-13

**Status: bounded operational UI slice verified by typecheck/build and focused tests; actual signed-in use and source-job submission remain unverified.**

- Increased the dashboard's bounded discovery preview from 8 to 25 persisted records. Added an inline search across loaded address/owner/reason/action/source fields; status filters for discovered, candidate, qualified, CALL READY, and passed; and deterministic relevance/freshness/address sorting. It states that filters cover only the currently loaded page and links to the existing paginated Sources view for the full pool.
- Changed “Refresh desk” to “Refresh views”: it refetches persisted dashboard, transaction-readiness, and discovery queries and does not imply a source connector ran. Added a “Review & queue source refresh” link to the existing worker page, preselecting `DISCOVER_PROPERTIES`. The existing worker page retains role checks, current-terms confirmation, durable job status and recurring-policy controls; the dashboard does not bypass those gates or claim refresh completion.
- Added a deterministic pure filtering/sorting helper and explicit synthetic-record tests for status, search, ranking ties, latest observation and address ordering. Existing contact gating remains fail-closed.

**Checks this turn:** `pnpm --filter @workspace/radical-deal-os run typecheck` passed; focused UI state tests passed **7/7**; `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` passed with existing sourcemap and bundle-size warnings. API typecheck passed, auth tests **7/7**, API build passed. The live permitted source exercise passed again: 594 persisted unique discoveries, 0 raw-to-lead promotions, 165 unmatched observations; OPA, L&I violations, unsafe buildings, vacancy, permits, demolitions, and sheriff deed were `LIVE_AND_OBSERVED`; Zillow/Redfin listing-description capability remained unavailable with no registered terms-reviewed connector. The synthetic persisted acquisition-queue/call-note exercise passed. A first UI typecheck attempt caught an incorrect helper timestamp/type contract; it was corrected before final passing typecheck/build. No code changes were required in the API.

**Runtime/browser:** all three configured workflows were running after restart (web Vite ready, API listening, mockup preview ready). Preview screenshot still showed the public sign-in page; no authenticated owner session was available to exercise the dashboard, queue the worker, or verify note refresh in browser. No source refresh job was submitted in this turn and no live seller contact or buyer data was fabricated.

**Next blocker:** obtain a legitimate owner browser session for signed-in verification; after that, exercise the existing terms-reviewed worker route through the UI and confirm its persisted run result. The property feed remains live but does not provide a permitted direct seller contact route.

**Turn state:** stopped after the coherent UI delivery and checks; no background Agent task is running. The separately queued follow-ups remain subject to task-feed concurrency and have not been executed by this turn.

## Dashboard discovery pagination connected to persisted qualification pool — 2026-10-13

**Status: implemented and typechecked/built; signed-in UI pagination remains unverified. This does not make P10 or the live end-to-end seller workflow GREEN.**

- The authenticated dashboard’s Philadelphia discovery query now carries its selected qualification status and stable API cursor, with bounded pages of 25. Previous/next controls traverse the saved discovery pool; changing status or refreshing resets to the first page. Counts remain server-provided, while search and ranking sort operate on the currently loaded page. The existing Sources page remains the full evidence/review surface.
- Kept qualification gates, source provenance, stale/error/401/403 UI behavior, direct-contact fail-closed behavior, and existing persisted call-note invalidation unchanged. No fabricated analysis, contacts, seller claims, buyers, outreach, or offers were introduced.
- API property-source exercise passed against permitted public Philadelphia data in its isolated schema: **594 unique persisted public discoveries; 0 raw discoveries promoted to active leads; 165 unmatched observations; 24 pages at 25 properties/page**. Live feeds reported OPA 594, L&I violations 96, unsafe 87, vacancy 87, permits 90, demolitions 104, sheriff deed 730 observations (651 source event records); cross-source deduplication retained observations. Direct contact routes remained unavailable (0 phone/email/web). The source exercise's 110 synthetic pagination fixtures remained synthetic and separate.
- Persisted synthetic acquisition-queue exercise passed: current direct-route CALL NEXT, postal/no-route/stale/conflict blocks, missing-underwriting block, audited call start/result, material seller evidence invalidation, and non-material note preserving analysis. Persisted command-center exercise passed for zero-data state, unavailable providers/templates, worker states, and authorization boundaries. These are synthetic exercises, not live seller workflow proof.

**Checks:** web and API typechecks passed. `test:command-center` passed **12/12**; auth tests passed **7/7**; property-discovery ranking tests passed **2/2**. API build and web build passed; web build retains sourcemap and >500 kB bundle warnings. The first web typecheck during pagination wiring failed on declaration order and generated status typing; both were corrected, and the final web typecheck passed.

**Browser boundary:** signed-in owner session was unavailable. No authentication bypass was attempted; therefore dashboard pagination, source-refresh worker handoff, and call-note reload were not browser-exercised. No source job was queued.

**Next blocker:** legitimate signed-in owner browser verification of the command-center-to-source-review flow; real direct seller contact and current approved buyer evidence remain unavailable dependencies for a live CALL NEXT-to-disposition transaction.

**Turn state:** implementation/checks completed; no background Agent task is running.

## Dashboard cursor traversal for the persisted acquisition pool — 2026-10-13

**Status: code and API pagination behavior verified; authenticated browser interaction remains unverified.**

- The command-center discovery panel now requests server-side qualification status and bounded cursor pages (25 records), with previous/next navigation, page counts, and reset-to-first-page behavior when the status changes or the operator refreshes. Search/sort apply to the loaded page; the full evidence and promotion workflow remains in Sources. No second discovery store or lead path was introduced.
- Fixed the dashboard request typing/order after the first typecheck identified state used before declaration and a mismatch between discovery status types. Final web/API typechecks passed.
- `test:command-center` passed **12/12** (API route behavior, UI state distinctions, live/synthetic provenance labels, fail-closed contact readiness); `test:auth` passed **7/7**; `test:property-discovery-ranking` passed **2/2**.
- `exercise:property-source` passed with live permitted public records in an isolated schema: **594 unique discoveries, 0 raw-to-lead promotions, 165 unmatched observations, 24 property pages at 25/page**. Feeds exercised: OPA, L&I violations, unsafe buildings, vacancy, permits, demolitions, and sheriff deeds. Direct contact routes: **0 phone, 0 email, 0 web**. Synthetic pagination/qualification fixtures remained separate.
- `exercise:acquisition-queue` passed with synthetic cases for permitted direct-route CALL NEXT, postal/no-route/stale/conflicting contact blocks, missing underwriting, audited call start/result, material evidence invalidation, and non-material note preservation. `exercise:command-center` passed its isolated persisted readiness/provider/worker/authorization cases.
- API build passed. Web build passed with existing sourcemap and bundle-size warnings. All configured web, API, and mockup workflows were restarted and reported RUNNING.
- Browser screenshot still showed the public sign-in/registration landing page. No legitimate signed-in session was available; dashboard cursor clicks, note reload in browser, and source-worker queuing were not claimed or attempted through an auth bypass. No source job was queued.

**Next blocker:** authenticated owner verification remains the next UI proof; independently, a real permitted direct seller contact route and real current buyer evidence are still absent, so no live seller-to-buyer deal can yet be proven.

**Turn state:** stopped after implementation, exercises, builds, and workflow checks; no background task is executing.

## Command-center seller contact and buyer qualification handoffs — 2026-10-13

**Status: existing persisted intake workflows are now reachable from the relevant command-center actions; no provider or human evidence was fabricated.**

- Blocked acquisition cards now route by persisted blocker: contact blockers open the lead’s Evidence tab at the seller-contact/contact-evidence panel; missing or stale underwriting opens Underwriting; other blockers open property Evidence. Only `CALL_NEXT` still opens the call brief. This prevents the prior dead-end of sending a blocked contact item into Calls.
- Added a direct command-center link to the existing prospect intake flow. `/buyers?tab=prospects&new=prospect` opens the unverified-prospect tab and form when the signed-in user has research permission. Saving still creates only a discovered/unverified prospect; criteria, dated evidence, owner review, funding evidence and freshness gates remain necessary for current approval.
- Kept the existing source-refresh handoff: the dashboard opens `/workers?kind=DISCOVER_PROPERTIES`; the existing worker page requires current source-term confirmation and queues the persisted, idempotent `DISCOVER_PROPERTIES` job. `exercise:property-source` exercised that job path against permitted public feeds. “Refresh desk” remains a UI refetch, not a claim that a source job was queued.
- Existing provider-neutral seller-contact request lifecycle and manual evidence intake were reused. No live contact provider is configured; actual registry state remains unavailable. Manually entered phone/email/web routes remain source/permission/identity-reconciliation evidence and cannot clear CALL NEXT until reviewed. No outreach was sent.
- Added command-center state-helper tests asserting blocked contact and underwriting routing, CALL NEXT routing, and buyer-intake deep-link state.

**Checks:** web/API typechecks passed; API build passed; web build passed with existing sourcemap-resolution and large-chunk warnings. Command-center/API tests passed **14/14**, including HTTP 401 and controlled 500 behavior; auth tests passed **7/7**; deal-domain suite passed **105/105**.

**Persisted exercises (synthetic isolation unless explicitly described as live source records):**
- Seller contact exercise passed direct-route state, provenance/dedupe/ranking, postal-only, stale/conflict/unreviewed blocking, identity/authority separation, role/replay guards, and economics/stage invariants.
- Seller contact provider exercise passed **12 synthetic requests**, including unavailable real registry, unexercised/policy/terms blocking, no-result, stale/duplicate/conflicting evidence, bounded retry/recovery, audit/economics invariants and no outreach.
- Buyer exercise passed create/reload, owner-only verification, dated funding, stale evidence, version conflict, identity invalidation and queued matching. Buyer-pool exercise passed one-time response link, criteria carry-forward, replay/stale/replace/expiry and no automatic approval; it observed **112 source-derived prospect observations / 114 source observations** in its isolated exercise, not in the live workspace buyer pool. It sent no communications.
- Live permitted property-source exercise passed: **594 unique public discoveries, 0 raw-to-active-lead promotions, 165 unmatched observations, 24 pages at 25/page**; 0 phone/email/web routes were present. `exercise:command-center` passed isolated persisted empty/provider/readiness/authorization/worker-state cases.

**Browser/auth boundary:** screenshot still shows the public sign-in landing page; there is no legitimate owner session available to the capture browser. The newly added owner-only prospect dialog and signed-in blocked-contact links were not browser-clicked. Production authentication was not bypassed. No approved/current buyer or callable live seller was created.

**Next blocker:** obtain a legitimate permitted seller contact route and real buyer qualification evidence; authenticated owner browser verification remains outstanding.

**Turn state:** completed code/test/build/workflow checks; no background Agent task is running.

## Seller contact review handoff correction — 2026-10-13

**Status: implemented and locally verified; live call readiness remains blocked by the absence of a legitimate direct contact route.**

- Fixed the lead-level “Review best available contact route” action. When a qualified lead has no seller phone, it previously sent the operator back to the source-discovery page, where a promoted discovery no longer exposes the evidence-entry form. It now opens that lead’s persisted contact-evidence panel directly (`/deals/{leadId}?work=contact`). The route uses the existing lead/contact evidence model and does not create a route, promotion, call, or outreach.
- Added a pure route helper and regression test proving URL-safe lead IDs and direct navigation to the contact review workflow. The lead detail page maps `work=contact` to its existing Evidence tab.
- This closes the dead-end after human promotion: sourced qualification → active lead → contact evidence review. Human-added contact evidence still requires legitimate provenance, permission and owner review; it does not by itself establish seller identity/signing authority or clear CALL NEXT.

## Block 15 — Call workflow, notes, and follow-up scheduling — 2026-10-14

**Status: PARTIAL; seller call workflow strengthened and verified. Buyer qualification calls remain in the separate human-handoff workflow and are not yet ranked in the same CALL NEXT view. No calls are claimed to have occurred.**

- The seller CALL NEXT flow continues to use current direct-phone permission, fresh contact evidence, underwriting readiness, source-backed call brief, and explicit audited call-session start. Existing brief data keeps observed facts separate from indicated seller claims and hypotheses.
- The call form now records an operator-entered actual call timestamp separately from the database record/create timestamp. The API returns the event timestamp after reload, falling back to the historical record timestamp for older calls.
- Added an optional client submission idempotency key. The current UI reuses one key across retries and rotates it only after success. While holding the lead lock, the service fingerprints the original submitted payload and actor: identical replay returns the persisted call without another row; reuse with changed content or another actor conflicts; a fresh key with stale lead version is rejected.
- Existing call audit, linked seller evidence, follow-up date validation, material-evidence reconciliation, and stale-analysis/offer-authority protection remain active. The form still requires an explicitly selected human outcome and future next step/follow-up except for NOT_INTERESTED. It does not imply telephony or infer motivation as verified fact.
- Buyer qualification contact notes, permission review, and due follow-up continue through the existing persisted human-handoff workflow, but are not presented as buyer call briefs in the ranked seller acquisition queue. This is the remaining in-scope gap; buyer calls must not be fabricated to fill it.

**Verification on 2026-10-14**
- OpenAPI code generation and workspace library typecheck: **PASS**.
- `pnpm --filter @workspace/api-server run exercise:acquisition-queue`: **PASS**, isolated persisted synthetic exercise. It verifies call eligibility/route gates, viewer denial, future follow-up validation, explicit timestamp and note reload, exact replay deduplication, changed-content replay rejection, stale-version rejection, provenance linkage, and seller-answer fact/hypothesis boundaries.
- `pnpm --filter @workspace/api-server run exercise:handoffs`: **PASS**. Public-source prospect records are persisted only in the isolated exercise schema and remain unverified; buyer contact/reply events in fixtures are synthetic, not real calls.
- `pnpm --filter @workspace/api-server run test:auth`: **7/7 PASS**; deal-domain suite: **105/105 PASS**.
- API and web typechecks, API build, and web build (**PORT=3000 BASE_PATH=/**) **PASS**. Existing API bundle-size, web sourcemap-resolution, and >500 kB chunk warnings remain.
- Restarted the existing API and web workflows once; both report RUNNING with no startup errors. Unauthenticated `POST /api/leads/{id}/calls` returned **401** after restart. Signed-in owner UI was not verified because no legitimate owner session was available.

**Next single task:** add eligible buyer qualification calls to the ranked call workflow with a source-backed buyer brief, role/permission gate, persisted call notes, and due follow-up, reusing the current buyer handoff/evidence records.

**Verification:** web typecheck and build passed (existing Vite sourcemap and bundle-size warnings); API typecheck/build passed; command-center/API tests **15/15** passed, including unauthenticated 401 and controlled 500 checks; auth suite **7/7** passed; domain suite **105/105** passed. Persisted synthetic seller-contact exercise passed route provenance, postal-only/stale/conflict blocking, identity/authority separation, replay protection, and economics/stage invariants. The existing command-center, buyer intake and live source worker exercises remain as recorded above; this change did not alter API or source behavior.

**Runtime/auth boundary:** web, API and mockup preview workflows are running. Public preview remains the sign-in screen; no legitimate owner browser session is available, so authenticated clicking through this corrected route remains unverified.

**Next blocker:** a lawful, current direct seller contact route is still absent from the available public feeds and workspace; no real seller can be promoted to CALL NEXT until such evidence is obtained and reviewed. No live approved buyer or transaction evidence is present either.

**Turn state:** stopped after implementation and checks; no background Agent task is running.

## Block 17 — Underwriting evidence and deterministic offer guardrails — 2026-10-14

**Status: PARTIAL; deterministic calculation display and fail-closed comp risk gates are implemented and tested. An authenticated owner browser session and a live, source-complete underwriting record were not available for UI verification.**

- Expanded the existing lead-detail underwriting panel with a source-grounded calculation view: eligible comps and sale dates, linked evidence source/capture time/confidence when present, explicit “not recorded” labels when absent, repair estimate sources and evidence, and deterministic cost/economics components.
- The panel shows carrying/closing cost assumptions, buyer discount/margin reserve, buyer ceiling before assignment, assignment target (explicitly not a realized fee), calculated MAO, and the separation between underwriting and actual owner offer authorization.
- Every configured assumption is marked ESTIMATED or INFERRED, attributed to workspace policy, timestamped to the analysis snapshot, and described as policy rather than empirical confidence. No live buyer demand or realized assignment economics are inferred.
- Added deterministic blockers for material price-per-square-foot comp outliers and ARV dispersion above the existing 25% risk limit. Existing eligibility rules continue to exclude stale, unverified, non-renovated, duplicate, distant, and subject-property comps; insufficient eligible comps and repair-evidence blockers withhold offer readiness. These blockers flow through the existing call-ready/offer gate.
- Added regression coverage for the MAO formula, boundary flooring at zero, stale comps, contradictory/outlier comps, immutable calculation assumptions, and the invariant that underwriting never sets an approved acquisition price. Existing repair tests continue to prove AI hypotheses cannot alter repairs or MAO.

**Verification completed:**

- `pnpm --filter @workspace/deal-domain exec tsx --test src/*.test.ts` — PASS, **108/108**.
- `pnpm --filter @workspace/api-server run test:auth` — PASS, **7/7**.
- API and web TypeScript checks — PASS.
- API and web production builds — PASS. Existing source-map and large-chunk warnings remain on the web build; API bundle-size warnings remain.
- `pnpm --filter @workspace/api-server run exercise:seller` — PASS, isolated persisted synthetic exercise; confirmed persist/reload, provenance rejection, deterministic snapshot, stale/concurrent write rejection, readiness, immutable evidence, and analysis invalidation. No real seller offer or authorization was created.
- Restarted API and web workflows; both report RUNNING. HTTP `GET /api/leads` returns **401** while signed out, confirming the authentication gate. No legitimate owner browser session was available, so the signed-in evidence panel could not be visually verified.

**Remaining blockers:** Real property/deal evidence is still needed to produce a live underwriting snapshot; the signed-in panel and any live offer readiness remain unverified. Missing or unlinked source evidence is shown as not recorded and must be resolved before relying on the corresponding value.

**Next single task:** add eligible buyer qualification calls to the ranked call workflow with a source-backed buyer brief, role/permission gate, persisted call notes, and due follow-up, reusing current buyer handoff/evidence records.

## Block 18 — Security, privacy, and role-bound action gates — 2026-10-14

**Status: PARTIAL; sensitive internal routes now deny VIEWER and PENDING roles before response handlers. The full field-by-field visibility matrix for authorized roles and all signed-in UI paths remains unverified.**

- Added one shared sensitive-workspace gate after authentication and membership checks on deal, operations, property-source, internal distribution, and internal seller-offer routers. OWNER, ANALYST, and OPERATOR are allowed; VIEWER and PENDING receive 403 before a handler can return contact details, exact addresses, financial evidence, contracts, or outbound-action records.
- Kept existing action-specific authorization in place. Audit history is now owner-only; worker-job and outcome-learning reads are restricted to OWNER/ANALYST. No auth checks were removed or broadened.
- Added a negative authorization test that asserts viewer/pending requests do not continue to sensitive response handlers and receive only the generic permission error. Added a persisted cross-record document test: a document ID from one synthetic deal cannot retrieve bytes when paired with another deal ID.
- No secret values were read, logged, or added. Existing audit writes were preserved. Exercises used isolated synthetic records; no production or live seller/buyer data was changed.

**Verification completed:**

- `pnpm --filter @workspace/api-server run test:auth` — PASS, **8/8**.
- `pnpm --filter @workspace/api-server run exercise:property-contact-http` — PASS, isolated synthetic HTTP route/role/replay/reload exercise.
- `pnpm --filter @workspace/api-server run exercise:seller-offer-portal` — PASS, isolated synthetic token rotation/revocation, secrecy, verification, and portal lifecycle exercise.
- `pnpm --filter @workspace/api-server run exercise:transactions` — PASS, isolated synthetic persisted lifecycle; includes the new cross-deal document-ID denial plus existing owner-only financial evidence and stale/mismatched transaction evidence checks.
- API and web typechecks — PASS. API and web builds — PASS; existing API bundle-size and web sourcemap/large-chunk warnings remain.
- Restarted API workflow; API, web, and mockup workflows report RUNNING. `GET /api/leads` without a session returns **401** with the expected sign-in error.

**Remaining security limitations:** A legitimate owner session was unavailable, so signed-in UI and role-specific visual redaction could not be verified. VIEWER is denied sensitive internal payloads rather than receiving a partially redacted deal response. OWNER, ANALYST, and OPERATOR work within the same shared workspace; this change does not add per-user record ownership. Public capability-token portals remain outside the internal role middleware, and every address-redaction variant was not independently re-tested in this block.

**Next single task:** define and test the field-level visibility matrix for OWNER, ANALYST, and OPERATOR, then verify buyer/seller portal redaction and sensitive-action gates through authenticated API coverage.

## Block 19 — Operator exceptions, recovery, and reliability — 2026-10-14

**Status: PARTIAL.** Durable worker jobs now have bounded retry, dead-letter, duplicate-replay protection, and stale-lease recovery. This does not yet unify source-refresh, stale-evidence, provider, contact-conflict, delivery, signature/funds, and deadline exceptions into one operator-owned exception register.

- Worker failures retain attempt history and requester/owner context. Retryable failures stay `QUEUED` with exponential backoff (15s, 30s, capped at 5m); the third failed attempt becomes `FAILED` with a dead-letter timestamp and an explicit operator next action.
- Stale `RUNNING` leases are recovered with conditional version/state checks to avoid overwriting a concurrent claim. System-scheduled work remains explicitly unassigned to a human; it is not falsely labeled as operator-owned.
- Duplicate submission keeps the same durable job identity. Dead-letter replay does not execute again. The transaction lifecycle exercise now asserts first-attempt retry state and persisted recovery history, rather than expecting immediate terminal failure.
- Synthetic exercises used isolated test-schema records only. No real seller/buyer record, external provider, delivery, or live operational failure was exercised.

**Verification completed:**

- `pnpm --filter @workspace/api-server run test:worker-recovery` — PASS, **2/2**.
- `pnpm --filter @workspace/api-server run test:auth` — PASS, **8/8**.
- `pnpm --filter @workspace/api-server run test:provider-health` — PASS, **3/3**.
- `pnpm --filter @workspace/api-server run exercise:worker-recovery` — PASS, isolated persisted synthetic test: three failed attempts, two queued retries, final dead-letter, duplicate replay safety, concurrent claim safety, and stale-lease recovery.
- `pnpm --filter @workspace/api-server run exercise:transactions` — PASS, isolated persisted synthetic transaction lifecycle; first worker failure persisted as queued with attempt 1 and recovery history. The broader transaction exercise also passed its document, deadline, evidence, permission, and closure assertions.
- API typecheck and build — PASS.
- Web typecheck — PASS. Web build — PASS with `PORT=20639 BASE_PATH=/`; existing sourcemap and large-chunk warnings remain.
- Restarted `artifacts/api-server: API Server`; workflow is RUNNING and listening on port 8080. `GET http://127.0.0.1:8080/api/leads` returned **401** while signed out, confirming the internal auth gate only; no legitimate owner session was available.
- An initial web build without `BASE_PATH` failed because the artifact requires that environment variable; rerunning with its configured artifact values succeeded. There is no separate `test:transactions` script; the persisted `exercise:transactions` command is the transaction integration check.

**Remaining blockers:** Recovery policy currently covers worker jobs, not a unified operator exception lifecycle across all requested business domains. No real provider outage or live external failure was induced; no owner session was available for authenticated UI verification. The synthetic exercise advances retry timestamps in persisted test data rather than waiting through real backoff intervals.

**Next single task:** connect source-refresh, contact, delivery, and transaction exception records to a shared operator recovery queue with explicit owner, severity, next action, retry/dead-letter state, and evidence-backed resolution.

## Block 20 — Full workflow acceptance and operational readiness gate — 2026-10-14

**Status: NOT READY for live business operations; synthetic acceptance PASS.** Added a repeatable gate that reports synthetic workflow acceptance, permitted public-source evidence, and live operational proof separately. `exercise:operational-readiness` exits **2** while live requirements remain unverified; this is an intentional fail-closed readiness result, not a passing readiness claim.

- Gate includes authorization, buyer outreach, command-center HTTP/UI-state, provider-health, transaction-readiness, worker-recovery, and deal-domain tests; persisted exercises cover permitted property discovery, qualification/underwriting/call notes, deterministic underwriting, buyer matching, package distribution and transaction/closing, exception recovery, and cross-domain next action.
- The property-source exercise queries the registered Philadelphia public-source adapters and verifies permitted source traversal. Its observations are persisted only in the isolated exercise schema; it proves a permitted feed check, not a real current lead or a main-workspace source refresh.
- Synthetic fixtures remain explicitly synthetic. No gate step claims a real call, approved buyer, sent message/package, signature, funds transfer, or closing.
- Added gate evaluator regression tests: synthetic passes cannot produce READY without live proof; a failed required check fails the gate; permitted-source probes are reported separately from synthetic exercises.
- The gate writes its machine-readable result to `docs/real-estate-os-readiness-report.json`. The initial full run passed all checks; the report was corrected to classify the successful Philadelphia feed traversal as a permitted-source check, not as a synthetic fixture. The corrected report retains the same measured statuses.

**Verification evidence from `pnpm --filter @workspace/api-server run exercise:operational-readiness`:**

- Test checks all passed: auth **8/8**, buyer outreach **3/3**, command center **17/17**, provider health **3/3**, transaction readiness **5/5**, worker recovery **2/2**, and deal domain **108/108** — **146/146** total.
- Persisted exercise checks all passed: `exercise:property-source` (registered permitted Philadelphia feeds; isolated persistence), `exercise:acquisition-queue`, `exercise:seller`, `exercise:buyer-pool`, `exercise:transactions`, `exercise:worker-recovery`, and `exercise:intelligence-loop`. Only the source adapter check queried live public feeds; other exercises used isolated synthetic records.
- API and web typechecks and builds — PASS. Web production build retains existing sourcemap-resolution and large-chunk warnings; API bundle-size warning remains.
- Gate report: `syntheticWorkflowStatus=PASS`, `permittedSourceStatus=PASS`, `failedCheckIds=[]`, `operationalStatus=NOT_READY`. The command exits 2 by design because provider/live proof checks remain UNVERIFIED.
- The persisted main-workspace provider-health snapshot identifies the earliest blocker: Philadelphia source adapters are **DEGRADED / ADAPTER_REGISTRATION** (registered, but no successful persisted source job in the main workspace). Contact research, outbound messaging, signature, closing coordination and managed private storage are **UNCONFIGURED**.
- No signed-in owner session was available. The authenticated UI was not verified. Per the instruction, workflows were not restarted; API, web and mockup workflows were already RUNNING. The prior signed-out API smoke response remains an auth-gate check only, not owner proof.

**Earliest remaining blocker:** establish and persist a successful permitted property-source refresh in the main workspace, then obtain a current, owner-reviewed direct seller contact route. The isolated source exercise is not a substitute for either.

**Next single task:** perform one owner-authorized, permitted source refresh in the main workspace and verify its persisted job, freshness, and source-backed observation through the authenticated API.

## Block 21 — Canonical deal state and cross-workflow consistency — 2026-10-14

**Status: PARTIAL.** The lead row's `stage` and `version` remain the canonical aggregate deal state. Stage-transition audit records now explicitly persist the previous/resulting versions, previous/resulting stages, actor, timestamp, reason, next action, and available analysis snapshot reference. No migration was needed; the existing append-only audit detail stores the versioned event.

- Added a pure versioned transition-event constructor and tests for exact revision edges, actor/time/reason/next action, evidence references, and no fabricated evidence.
- Added a persisted assertion to the transaction lifecycle exercise: the audit event for CALL_READY must agree with the stored stage transition, current lead revision, actor, and analysis snapshot reference.
- Existing row-lock/version checks, transaction-local versions, transaction lifecycle tests, and Block 20 cross-domain synthetic acceptance remain in place. No legal transition rules were loosened.
- Focused tests: `pnpm --filter @workspace/api-server run test:canonical-deal-state` — PASS, **2/2**.
- Persisted check: `pnpm --filter @workspace/api-server run exercise:transactions` — PASS, isolated synthetic lifecycle; canonical transition audit assertion and existing stale/version, authorization, transaction, deadline, and evidence checks passed.
- API/web typechecks and builds — PASS. Existing API bundle-size and web sourcemap/large-chunk warnings remain.
- No workflows were restarted, as requested. Workflows remain RUNNING, but the API process was not restarted to load the changed server bundle. No signed-in owner session was available.

**Remaining blockers:** This slice does not yet provide one aggregate revision/event for every material evidence, underwriting, buyer-qualification, outreach, offer, and package mutation. Some domains retain their own versioned records; no cross-module snapshot validator rejects every possible disagreement. UI consumption of a single aggregate revision and authenticated HTTP stale-write/concurrency coverage remain unverified. The persisted exercise was synthetic and does not establish a real deal.

**Next single task:** propagate the canonical lead revision through all material domain mutations and add a persisted cross-module consistency exercise that proves stale/conflicting snapshots are rejected without deleting history.

## Block 22 — One next action and human approval boundaries — 2026-10-14

**Status: PARTIAL.** The existing command center emits one persisted decision/action per deal. An overdue or ≤72-hour contract closing deadline now takes priority over routine buyer/transaction work (priority 130) and requires owner authorization. Its link opens transaction review; it does not claim to resolve or complete a deadline.

- Incremented the intelligence decision rule version so persisted work identity changes when prioritization semantics change.
- Corrected “required evidence” guidance: it names prerequisites for calls, offer authorization, contact research, underwriting, buyer demand, reconciliation, and transaction work rather than echoing already-known evidence references.
- Human boundaries now clarify that call links do not place calls, offer links do not approve/communicate offers, transaction links do not establish signatures/commitments/funds, and discovery review requires an explicit human promote/pass decision. Safe preparation is not reported as completion.
- Existing role filtering, blocked CALL NEXT, and workflow navigation remain intact. No new control claims to execute an external action.

**Verification completed:**

- `pnpm --filter @workspace/deal-domain test` — PASS, **110/110**, including imminent/overdue deadline priority, far-deadline behavior, and authorization requirement.
- `pnpm --filter @workspace/api-server run test:command-center` — PASS, **17/17**, including action ranking/display, auth denial, stale-data state, and no false delivery claims.
- `pnpm --filter @workspace/api-server run exercise:command-center` — PASS, persisted isolated synthetic exercise; verifies one principal action per deal, role responsibility, required work guidance, source-authorization lanes, and provider-unavailable truth.
- API and web typechecks — PASS. API and web builds — PASS; existing bundle-size and sourcemap warnings remain.
- No workflow restart or signed-in owner UI verification was performed, as requested. Workflows were already running; the API process may not load the newly built server bundle until a later authorized restart.

**Remaining blockers:** Deadline prioritization currently uses the contract closing date; it does not yet rank every title/inspection/EMD/funds milestone deadline from the transaction schedule. Human click-through and completed-action feedback were not verified with a legitimate owner session. Existing links navigate to workflows; they do not autonomously execute protected actions.

**Next single task:** rank each persisted transaction milestone deadline and exception as the deal’s principal action when it is the earliest active blocker, with role-specific required evidence and persisted resolution status.

## Block 23 — Evidence freshness and conflict resolution service — 2026-10-14

**Status: PARTIAL.** Added a shared evidence-integrity domain primitive for source-backed freshness, explicit confidence thresholds, epistemic classes, conflict grouping, and resolution instructions. The lead decision loop now checks dated property facts, seller/buyer intelligence claims, contact paths, and underwriting snapshot freshness; buyer verification uses the same freshness and confidence primitives. Expired or provenance-incomplete evidence generates visible `REFRESH_SOURCE_EVIDENCE` or `RECONCILE_EVIDENCE` work, and contradictory claims keep each original source record and reference in the decision. The rules fail closed at exact expiry/max-age boundaries.

- Epistemic labels distinguish observed, seller-reported, buyer-reported, provider-confirmed, inferred, estimated, and unknown evidence in the shared type. Seller/buyer summaries retain their source, confidence, and captured time; buyer qualification keeps its explicit 0.65 reviewer-confidence threshold.
- Existing deterministic underwriting continues to reject stale/conflicting comps and applies repair evidence rules. Existing transaction readiness gates continue requiring real provider evidence for signature/funds progression. These transaction-domain records have not yet been routed through the new shared evaluator; delivery, signature, and funds re-verification therefore remain separately handled.
- `RECONCILE_EVIDENCE` retains affected source references and requires human review, but Block 23 does not yet persist a general reviewer resolution event with before/after evidence and rationale. Prior source records are not overwritten by the new conflict detection.
- Focused domain suite `pnpm --filter @workspace/deal-domain test` — PASS, **118/118**, including stale-to-current same-value re-verification while retaining the prior source.
- Command-center tests `pnpm --filter @workspace/api-server run test:command-center` — PASS, **17/17**.
- Persisted isolated exercise `pnpm --filter @workspace/api-server run exercise:intelligence-loop` — PASS. **12** synthetic evaluations (A–K; C retains before/after snapshots), **18** persisted work items, and queued worker SUCCEEDED. Expired evidence persisted refresh work; contradictory public/seller statements persisted both evidence references and reconciliation work; same-value re-verification cleared the stale block while retaining historical evidence. All records remained synthetic.
- Workspace typecheck `pnpm run typecheck` — PASS. API build — PASS. Web production build `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` — PASS; existing source-map and >500 kB chunk warnings remain.
- API workflow restart and post-restart log check completed after build; no authenticated owner session was available, so signed-in UI behavior and live provider/signature/funds evidence were not verified.

**Remaining blockers:** route provider delivery, signature, and funds evidence through the shared freshness/conflict evaluator while retaining their domain-specific approval gates; persist reviewer resolutions as append-only audit events; expose current/stale/conflicted status and resolution history on deal evidence views. No live external evidence was created or claimed.

**Next single task:** persist reviewer decisions for conflicting source-backed property and seller facts without replacing the original evidence.

## Block 24 — Acquisition-to-closing deal timeline — 2026-10-15

**Status: PARTIAL.** Expanded the deal operations timeline as a chronological view over existing persisted records rather than writing duplicate or UI-generated “events.” It joins lead creation, qualification signals, stage transitions, intelligence evidence, underwriting snapshots, calls, offer approval/communication records, buyer matching state, contract history, distribution activity, deadline schedules, generated document records, milestones, and recorded outcomes. Each event uses its source record identity for stable rendering and replay deduplication.

- Added newest-first ordering with deterministic tie ordering, category filters, invalid-date exclusion, and first-record-wins duplicate handling.
- Timeline content is deliberately curated: call/transaction notes, buyer identity, document filenames, raw evidence URLs, private contact values, and financial amounts are withheld. Missing evidence is stated instead of inferred. A prepared document is not presented as signed; a distribution activity is not presented as provider delivery; an operator outcome is not presented as provider-verified.
- Added internal links to source workflows. Existing authenticated/member-protected lead and operations routes remain the data boundary; unauthenticated GET tests cover both detail endpoints.
- `pnpm --filter @workspace/radical-deal-os run typecheck` — PASS. Timeline helper tests — PASS, **4/4** (ordering, replay deduplication, filters, missing evidence).
- `pnpm --filter @workspace/api-server run test:command-center` — PASS, **17/17**, including unauthenticated denial on lead and operations detail routes.
- `pnpm --filter @workspace/api-server run exercise:transactions` — PASS, isolated synthetic lifecycle; persisted documents, signed/executed evidence boundaries, delivery blockers, deadlines, milestone ordering/evidence, and terminal closure were exercised. No live signing or delivery was claimed.
- Workspace `pnpm run typecheck` — PASS. Web production build `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` — PASS with existing source-map and large-chunk warnings. API build was unchanged by this UI-only slice.
- The timeline is rendered from persisted source records in authenticated deal detail/operations responses; no separate timeline table or duplicated event ledger was introduced. Workflow processes remain running. No authenticated browser session was available for signed-in visual verification.

**Remaining blockers:** expose provider-confirmed package delivery/response and buyer verification history as source records in the timeline; add a persisted integration assertion that compares timeline source IDs/order to the underlying domain records; obtain authenticated owner UI verification. The timeline currently represents only records available through existing detail and operations responses.

**Next single task:** expose source-backed buyer verification and provider delivery responses in the timeline without leaking buyer identity or treating an operator action as delivery proof.

## Block 25 — Human work reduced to the intended minimal loop — 2026-10-15

**Status: PARTIAL.** Inspected the current lead, call, offer, and contract flow. Implemented an optional “Reuse prior answers” action in seller call forms, available from both the call work queue and the lead detail. It reconstructs only the latest seller-call group from persisted, call-linked seller evidence; model/analyst items and old-call claims are excluded. Operators can review/edit the copied values before saving a new call. It neither places a call nor edits or overwrites prior evidence.

- Existing stage reuse was retained: a contract draft is created from the persisted communicated offer ID and server-side locked terms, rather than asking the operator to re-enter the purchase/assignment/contingency values.
- The seller answer reuse helper tests verify reconstruction from the newest call group, immutable prior data, and editable draft values — PASS, **2/2**.
- Persisted `exercise:seller` — PASS. It captures a call-linked seller answer, performs a later lead edit, verifies the original evidence remains present, and confirms a separate `LEAD_UPDATED` audit record.
- `pnpm --filter @workspace/api-server run test:command-center` — PASS, **17/17**; unauthenticated lead/operations/call routes remain denied. No approval, call readiness, provider delivery, offer authorization, or contract execution gate was changed.
- Workspace `pnpm run typecheck` — PASS. Web build `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` — PASS; existing source-map and large-chunk warnings remain. No API runtime change or schema migration was needed.
- No legitimate signed-in owner/operator session was available. Therefore the actual authenticated call-form interaction, copied values after navigation, and role-specific disabled state remain unverified in a browser.

**Remaining blockers:** repeat-entry reduction has only been applied to structured seller-call answers. Buyer outreach and package/provider response handoffs, cross-stage evidence navigation, and transaction clause preparation still need a measured review for safe data reuse. Keep Send, offer approval, contract terms, signature, funds, and special-clause decisions behind existing human gates.

**Next single task:** let operators review current, source-backed seller and buyer evidence in the call workflow without retyping it or carrying stale claims forward.

## Block 26 — Buyer Match Quality and Real Demand Proof — 2026-10-15

**Status: PARTIAL.** Improved matching explanation and review paths using the existing hard eligibility checks for owner-reviewed current buy boxes, geography and exclusions, property type/size, price, repairs/condition tolerance, close speed, current identity/current-buying proof, funding method, available funds after commitments, concurrent-deal capacity, and underwriting freshness. A buyer's checklist-fit percentage is explicitly labeled as such; it is not probability, approval, permission to contact, interest, or commitment.

- Match results identify verified buyers, prospects, stale records, referral destinations, and synthetic fixtures explicitly marked with the `SYNTHETIC FIXTURE:` source prefix. A marked fixture fails a hard eligibility check and cannot count as live demand. Contact permission is reported separately as permitted/opted-out/not reviewed/stale and never turns a match into permission to send.
- Matching rank is stable: eligible first, then checklist coverage, then buyer ID. Exclusions retain their specific mismatch reasons.
- When no acquisition buyer currently qualifies, deal operations names a concrete next step: qualify a buyer with a fitting current box or reverify stale evidence; it also distinguishes referral destinations from actual buyers and links to the prospects/reverification view.
- Added tests for standing/contact-permission distinctions, explicit fixture exclusion, and deterministic ranking. Domain suite `pnpm --filter @workspace/deal-domain test` — PASS, **120/120**; existing coverage also exercises hard geography/property/condition/close-speed constraints, stale/missing evidence, funding, and capacity.
- Persisted buyer qualification exercise `pnpm --filter @workspace/api-server run exercise:buyers` — PASS. It verifies owner-reviewed qualification, expiry/reverification, changed criteria, and current permission evidence. Persisted transaction lifecycle `exercise:transactions` — PASS; its address-disclosure permission and immutable economics/redacted packet assertions remain green.
- Workspace typecheck — PASS. Web and API production builds — PASS. The web build retains existing sourcemap and >500 kB chunk warnings. The transaction exercise emitted its expected synthetic worker-attempt warning but completed successfully.
- The preview screenshot showed the public sign-in screen, not the authenticated deal view. No legitimate signed-in buyer/deal session was available; visual review of the new matching panel remains unverified.
- Restarted the web workflow after the UI change and the API workflow after the final match-policy change; both are running. Logs show Vite ready and the API listening on port 8080 without startup errors.

**Remaining blockers:** fixture exclusion currently depends on the explicit `SYNTHETIC FIXTURE:` source prefix, not a separately governed fixture registry. Actual permitted buyer outreach remains a separate permission/provider workflow; this block does not send messages or treat a fit as demand proof. Live current buying intent and authenticated operator review were not verified.

**Next single task:** verify buyer match explanations, no-buyer acquisition actions, and permission labels with a legitimate owner session against real reviewed buyer records.

## Block 27 — Provider-Backed Action Reliability and Audit — 2026-10-15

**State: PARTIAL — truthful persistence is implemented for the existing permitted source-refresh and seller-contact-research paths; no external messaging, package delivery, or signature provider is configured.**

- Seller-contact research now persists a request-time authorization snapshot (actor, role, lead version, requested channels, provider IDs), stable idempotency key, and append-only attempt/response history in the request's JSONB record. Raw provider contact payloads and credentials are not stored in the history.
- API responses expose the authorization snapshot, attempt history, and an operation state distinguishing `NOT_CONFIGURED`, `AWAITING_APPROVAL`, `QUEUED`, `SUBMITTED`, `UNKNOWN`, `CONFIRMED`, and `FAILED`. A timeout is reported as `UNKNOWN` while retry is scheduled, and retry reuses the original request idempotency key. Terminal requests cannot be dispatched by duplicate worker callbacks.
- Public-source refresh already uses persisted worker jobs with source-terms/policy version in the request, job idempotency, bounded retries, and persisted attempt failure history. Persisted source exercise passed; contact routes remain unavailable from the live feeds.
- Synthetic persisted adapter exercise passed 15 cases, including timeout then retry, rate limiting/backoff, duplicate callback, provider authorization/configuration failure, changed/revoked terms, no-provider configuration, and immutable deal economics/stage/next-action. Worker recovery automated tests passed 2/2.
- API typecheck and build passed; web build passed with existing source-map and large-chunk warnings. Workspace typecheck passed. The aggregate workspace build stopped at the unrelated mockup-sandbox Vite config because `PORT` was not set; targeted API/web builds passed.
- No real email/text, buyer package-delivery, e-signature, or other integration credentials/permissions were used. Those paths remain unconfigured and must not imply queued/submitted/delivered success. A complete shared external-action ledger and provider-specific adapter integration remain outstanding.

**Next single task:** implement and exercise the shared durable action lifecycle for buyer messaging, package delivery, and signature requests once an authorized provider is configured; keep each channel explicitly `NOT_CONFIGURED` until then.

## Block 28 — Final Operational Proof, Bottleneck Fix, and Release Gate — 2026-10-15

**State: NOT READY for live operations; strict synthetic/integration coverage and permitted public-source exercise PASS.** The fail-closed gate exits 2 because live owner/provider evidence remains unverified. It does not count synthetic fixtures as a real deal, buyer commitment, delivery, signature, funds transfer, or closing.

- Added the requested 12-area readiness matrix to `docs/real-estate-os-readiness-report.json`, with distinct synthetic and live statuses, scope notes, and linked check IDs. The gate now includes persisted seller-contactability, offer-authorization, and closing-outcome exercises in addition to the existing source, underwriting, buyer, transaction, recovery, and command-center checks.
- The first gate attempt had marked permitted discovery failed because the durable run was `PARTIAL`, but its diagnostic hid the source-specific failure. The assertion now prints the persisted state/message. Repeated the source check standalone and in the full gate: both passed. The repeated public-source traversal persisted 590 unique OPA discoveries, 170 unmatched observations, and 651 sheriff-deed source records over 17 pages; 507 sheriff observations exact-matched, and raw discovery created zero active leads. Direct seller contact routes remain unavailable in the permitted feeds. The original transient partial did not reproduce.
- Full gate evidence at `2026-10-15T17:02:49.981Z`: all 8 automated test groups, permitted-source check, 9 isolated persisted exercises, API/web typechecks, and API/web builds passed; `failedCheckIds=[]`, `syntheticWorkflowStatus=PASS`, `permittedSourceStatus=PASS`, `operationalStatus=NOT_READY`. Exact machine-readable evidence and limitations are in `docs/real-estate-os-readiness-report.json`.
- Main-workspace provider snapshot remains `DEGRADED / ADAPTER_REGISTRATION` for Philadelphia public-record adapters and `UNCONFIGURED` for contact research, messaging, e-signature, closing coordination, and managed private storage. This is a persisted configuration/history snapshot, not a live provider probe. The gate identifies the source adapter snapshot as the earliest remaining operational blocker. No owner-authorized refresh into the main workspace was performed.
- Security scans were repeated after compatible dependency updates. Dependency audit: **0 critical, 1 high, 1 moderate**; SAST **0 findings**; HoundDog **0 findings**. The critical `proxy-addr@2.0.7` issue was resolved by updating to `2.0.8`. Remaining high: `braces@3.0.3` (`GHSA-vfj7-8cjw-p6xm`), pulled by `micromatch@4.0.8` through production `http-proxy-middleware@4.2.0` (also present under dev `fast-glob`); the audit supplied no fixed version. Remaining moderate: `postcss-selector-parser@6.0.10` under `@tailwindcss/typography`, with scanner fix `7.1.6` requiring a major upgrade; deferred to avoid an unreviewed breaking change.
- The report matrix records `PASS` synthetic and `UNVERIFIED` live for each target workflow area, with security scanner results separated from auth/provider-boundary tests: security `scannerStatus=FAIL` for the remaining audit findings, while SAST and HoundDog are clean.
- No legitimate signed-in owner session was available, so authenticated UI verification was not performed. No real messaging, package delivery, signature, funds, or closing provider was invoked. No secrets were read or exposed.

**Earliest remaining blocker:** persist a successful owner-authorized permitted property-source refresh in the main workspace; the passing source exercise uses an isolated schema and cannot establish that operational fact.

**Next single task:** with a legitimate owner session, run and verify one permitted Philadelphia source refresh in the main workspace, including its durable job, freshness, source-backed observations, and provider-health transition.

## Block 29 — Operational Configuration and Safe First-Run Setup — 2026-10-15

**Status: PARTIAL — owner-facing setup and persistence are implemented; external providers remain unconfigured until credentials are added through workspace Secrets and a real provider health check succeeds.**

- Added an Operational setup section to the existing Settings page and owner-protected `GET/PUT /api/workspace-setup` endpoints. Settings cover reviewed permitted sources, contact-research method, email/text/signature provider selection, manual or named title-partner workflow, state/county/ZIP coverage, and notification preferences. Existing underwriting thresholds remain in the established Assumptions form; the new page points operators there rather than creating a competing threshold store.
- Persisted configuration uses the existing settings table in its own settings record and records an audit event. Validation restricts source IDs, provider choices, state and ZIP formats, list sizes, required provider/partner names, and notification types. Malformed persisted data is surfaced as `INVALID` with a correction action, not silently presented as configured defaults.
- The API rejects credential-like field names and token/private-key-looking values, stores provider names only, and reports whether supported credential environment variables are present without returning their values. A selected provider without credentials is `MISSING`; credentials without a successful persisted real check can only be `CONFIGURED`; `VERIFIED` requires a successful persisted provider/source check. Selecting a provider never claims a connection.
- Setup statuses include `CONFIGURED`, `MISSING`, `INVALID`, and `VERIFIED`, with an exact next action. Current provider integrations are not connected; their next action is to add the required secret through workspace Secrets and implement/run an owner-authorized health check. Source term review is recorded separately from a successful source refresh. Manual workflows are described as manual, not as an external connection.
- `pnpm --filter @workspace/api-server run test:workspace-setup` — PASS, **4/4**, covering input validation, secret-like input rejection, owner authorization, and truthful provider-state transitions.
- `pnpm --filter @workspace/api-server run exercise:workspace-setup` — PASS, isolated persisted exercise: save/reload, owner-only write, invalid persisted setting visibility, manual contact method `CONFIGURED`, email provider `MISSING`, and no reviewed source marked connected. All records were synthetic and cleaned up.
- API and web typechecks — PASS. API and web builds — PASS. Existing web sourcemap-resolution and >500 kB chunk warnings remain; API bundle-size warning remains.
- Per instruction, no workflow was restarted. The running API process has not loaded the new routes yet; authenticated UI/API behavior was not verified in the live workflow. No provider credentials were requested, read, stored, or used.

**Remaining blockers:** no configured provider credentials, no real health-check adapters for messaging/signature/closing/contact research, and no owner-authorized source refresh verifying the main-workspace source connection. Routine preference, coverage, and manual workflow settings can be saved through the UI; actual provider connections cannot be claimed from configuration alone.

**Next single task:** implement an owner-authorized real health-check path for the first permitted property source, using reviewed terms and persisted check evidence to move its setup status from configured to verified without exposing credentials.

## Block 30 — Evidence-Backed Property Acquisition Queue — 2026-10-15

**Status: PARTIAL — deterministic priority, explanations, and explicit work items are implemented for the currently loaded discovery page; whole-pool ranking and authenticated UI verification remain open.**

- Added a shared, deterministic acquisition-priority helper. It compares qualification status, current verified permitted direct-contact availability, source recency (30-day freshness window), current linked underwriting classification, recorded next action, persisted priority/relevance, confidence, address, and stable record ID. Unknown underwriting stays `UNKNOWN`; dollar economics do not influence queue order.
- Each result explains those dimensions and surfaces work items for absent or unclassified source evidence, stale evidence, missing or review-required direct seller contact, qualification blockers, missing information, and unknown underwriting. It does not change qualification state, promote raw discoveries, assert seller motivation, or claim verified profitability.
- The dashboard defaults to the acquisition queue sort and supports the existing relevance, freshness, and address sorts. Queue rank is explicitly limited to records on the loaded page; underlying pages retain relevance-order cursor semantics. This is not yet a global rank over all persisted discoveries.
- Added domain tests for repeatable order and tie breaks, stale evidence, absent contact/source gaps, no auto-promotion, economic invariance, and unknown viability.
- Verification: `@workspace/deal-domain test` PASS (125/125); API and web typechecks PASS; API build PASS; web build PASS (existing sourcemap and large-chunk warnings); `test:property-discovery-ranking` PASS (2/2); `test:command-center` PASS (17/17); isolated persisted `exercise:property-source` PASS. The persisted run ranked a 590-record live discovery pool deterministically, confirmed missing-contact work, and confirmed zero leads from raw public-source discoveries.
- Restarted the web workflow and confirmed it serves the public landing page without browser errors. The screenshot browser is unauthenticated, so the signed-in dashboard and its queue were not visually verified. API live workflow was not restarted; no API route was added.

**Next single task:** implement a bounded, globally ranked acquisition-queue API over the complete discovery pool while preserving cursor semantics for the existing relevance list, then verify the signed-in dashboard consumes it.

## Block 31 — Seller Conversation Intelligence and Structured Capture — 2026-10-15

**State: PARTIAL — structured capture, provenance, uncertainty, follow-up questions, and persisted audit are implemented and synthetically exercised; the signed-in UI remains unverified.**

- Added conservative, deterministic extraction from operator-entered call notes for seller-reported situation, desired price, timeline, occupancy, condition, decision authority, access, objections, and follow-up. Each draft stores the exact source quote and note character offsets, confidence, attribution (`SELLER_REPORTED` or `INFERRED`), and edit/original-value state.
- Added an editable extraction review in the call form. Only fields explicitly attributed to the seller populate existing seller-answer evidence; inferred fields remain labeled, stored only with the call capture, and are not promoted to seller facts. Backend validation verifies all source offsets against the submitted note.
- The call queue adds unresolved topic questions to the next-call brief from the latest persisted capture. A capture audit records field keys, edited fields, attribution classes, validated anchors, and explicitly records `underwritingChanged: false`.
- Deterministic underwriting inputs are not changed by extraction. Existing material-evidence review/invalidation rules continue to apply to explicitly submitted seller answers; extraction itself does not alter underwriting.
- Added tests for source provenance, confidence/uncertainty, edits, invalid anchors, unresolved questions, exact duplicate submission, access gating on the call route, and underwriting invariance. The persisted acquisition-queue exercise passed with an edited field, saved note anchors, audit evidence, exact replay deduplication, and unchanged underwriting inputs.
- Verification: OpenAPI codegen plus library typecheck passed; deal-domain tests **128/128**; API and web typechecks passed; API typecheck/build passed; web build passed with `PORT=20639 BASE_PATH=/` (existing source-map and large-chunk warnings). Persisted `exercise:acquisition-queue` passed. Authenticated browser verification was not performed.
- The full structured capture is kept in the persisted call payload rather than duplicated into the broadly nested call response; linked seller-answer evidence and the audit remain the compact operator-facing record.

**Next single task:** continue Block 30's whole-pool acquisition ranking work as recorded above; do not claim the signed-in Block 31 form has been visually verified until an owner session is available.

## Block 36 — Release Candidate, Real-System Exercise, and Next Blocker — 2026-10-15

**Release decision: NOT READY for live operations.** Synthetic workflow behavior and a permitted public-source exercise passed, but the current release gate has unresolved live-system evidence and the authenticated UI was not verified. No external seller/buyer communication, signature, funds event, or closing was performed or claimed.

| Area | Result | Exact evidence |
| --- | --- | --- |
| Workspace typecheck | PASS | `pnpm run typecheck` passed library, API, web, mockup-sandbox, and scripts typechecks. |
| Domain tests | PASS | `pnpm --filter @workspace/deal-domain test`: 128/128. |
| API service tests | PASS | All 14 API test files passed: auth 8, command-center 17, transaction-readiness 5, outcome-learning 2, provider-health 3, worker-recovery 2, operational-readiness 4, canonical-deal-state 2, research 3, buyer-outreach 3, property-discovery-ranking 2, workspace-setup 4, transaction-signing-provider 1, worker-job-state 1 (57 total). |
| Web utility tests | PASS | All 4 web test files passed: command-center display/state were included in the 17 command-center tests; timeline and seller-answer reuse added 6 passing tests. |
| Builds | PASS | `PORT=20639 BASE_PATH=/ pnpm run build` passed all workspace builds. The web bundle still reports a >500 kB chunk warning. |
| Persisted synthetic release path | PASS | Isolated `exercise:offers`, `exercise:transactions`, `exercise:command-center`, and `exercise:outcome-learning` passed. The transaction exercise reported 1 synthetic transaction and 0 real transactions; unsupported signing, delivery, private managed storage, and jurisdiction-template gates remained blocked. |
| Permitted source exercise | PASS, bounded | `exercise:property-source` queried the already-reviewed public Philadelphia source adapters in an isolated schema: 590 unique discoveries, 170 unmatched observations, 0 active leads from raw discovery, and 0 direct contact routes. The listing-description capability remained unavailable. The source exercise does not prove seller contactability or broader source permission. |
| Authentication/authorization | PASS for automated checks | Auth tests passed 8/8; route tests rejected unauthenticated private requests with 401 and enforced role restrictions. No legitimate signed-in owner session was available for browser verification. |
| Whole operational readiness gate | INCOMPLETE / NOT READY | `exercise:operational-readiness` exceeded the 180-second run limit. The persisted readiness report dated 2026-10-15T17:02:49.981Z reports `NOT_READY`, zero failed synthetic checks, and seven unverified live checks: property adapters, seller contact research, outbound messaging, signature, closing coordination, private storage, and owner/external evidence. Its earliest blocker is degraded property-adapter registration history, explicitly not a live network probe. |
| Schema/migration check | BLOCKED / not applicable to this code correction | No migration directory or migration files are present. Read-only `drizzle-kit check` could not start because the configured AWS Data API driver had no `database` value. No schema push or database mutation was attempted. |
| Security snapshot | LIMITATION | The existing readiness report's 2026-10-15 scan lists 0 critical, 1 high (`braces@3.0.3`, no fix reported), 1 moderate (`postcss-selector-parser@6.0.10`, reported fix requires a major upgrade), 0 SAST findings, and 0 HoundDog findings. This security scan was not rerun in this RC pass. |

**Highest-impact defect fixed in this slice:** the persisted offer exercise exposed that an already owner-approved offer became `INVALIDATED` when the internal draft deadline passed, even if its separate approval was still current. Draft expiry is now enforced only while the offer is still a `DRAFT`; after approval, the approval's own expiry governs, while material snapshot/evidence changes still invalidate it. A regression test was added, `@workspace/deal-domain` passed 128/128, and the persisted `exercise:offers` passed after the fix.

**Verification notes:** The full `exercise:operational-readiness` command did not finish inside its 180-second limit, so this checkpoint does not claim a fresh complete gate pass. Its attempt reached the permitted-source check; that source exercise was then run independently and exited successfully. The API, web, and mockup-sandbox workflows were already running and were not restarted, as requested. The browser was not used to sign in or inspect authenticated pages. No credentials were printed or changed.

**Next single task:** verify an owner-authorized, source-backed seller and buyer contact route through the actual HTTP endpoints, including buyer contact-research role denial and route-specific permission; keep all outreach `NOT_SENT` until reviewed.

## Block 37 — Contact Research Workbench and Evidence Capture — 2026-10-15

**State: PARTIAL — manual seller and buyer contact evidence is persisted and reviewable, with identity conflicts kept separate from permission and qualification. No real external contact provider, contact route, or outreach was exercised.**

- Seller route capture now records an explicit observed timestamp and rejects invalid/future times. Its existing source identity, source URL, confidence, recipient/role claim, permission state, route review, freshness, reconciliation conflict, and deterministic next action remain attached to the observation. Unreviewed routes do not become call-ready or overwrite deterministic deal/underwriting fields.
- Buyer profile editing now supports a contact source-record URL, observed timestamp, and confidence. The backend validates HTTPS evidence URLs and timestamps. Route changes invalidate buyer identity/funding and buying-status review; old route provenance is cleared if a changed route is not accompanied by new source/timestamp evidence.
- Buyer contact-research and permission history are returned from a separate role-gated private endpoint, not from broad buyer/command-center aggregates. It provides the current source/timestamp/confidence, owner-reviewed channel permission history, and an explicit next action. Contact routes are not property facts, verified identity, consent, qualification, or outreach.
- Conflicting buyer phone/email routes are rejected on create and update with a review-required response; records are not auto-merged. Owner-only buyer permission writes remain separate, append evidence history, and require source, evidence URL, observed timestamp, channel, and expiry/opt-out state.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| OpenAPI generation and generated-library checks | PASS | `pnpm --filter @workspace/api-spec run codegen` passed; workspace generated-library typecheck passed. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed for API server, Radical Deal OS web app, mockup sandbox, scripts, and shared libraries. |
| Buyer provenance, conflict, permission and persistence exercise | PASS | `pnpm --filter @workspace/api-server run exercise:buyers` passed in an isolated persisted schema. It stored and reloaded route source/timestamp/confidence; rejected duplicate and conflicting identities including an update conflict; preserved owner-only permission history; rejected unauthorized permission and stale-version writes. All records were synthetic. |
| Seller route provenance, deduplication, conflict, staleness and no-promotion exercise | PASS | `exercise:seller-contact` passed, including exact retry deduplication without duplicate audit, separate observations for normalized duplicate routes, conflicting recipient claims, stale-only route blocking, and no unreviewed route copied into the call-ready field. |
| Seller contact provider-boundary exercise | PASS, provider unavailable | `exercise:seller-contact-enrichment` passed 15 persisted synthetic scenarios, including duplicate/conflicting routes, stale results, authorization, and no-provider states. No real source provider was connected. |
| HTTP access, redaction and reload exercise | PASS, seller route | `exercise:property-contact-http` passed against the actual seller contact router with isolated synthetic data and fake identity middleware: viewer denial, owner permission approval, duplicate replay, persisted reload, and no private route echoed in the denied response. The new buyer research GET role gate is present but still needs its own actual-HTTP role-denial test. |
| Builds | PASS with warnings | API build and web build passed. Vite reported existing source-map lookup warnings and a >500 kB bundle warning. |
| Runtime / signed-in UI | PARTIAL | Web and API workflows restarted and are running. Root preview renders the sign-in landing page; no legitimate owner session was available, so the changed buyer/seller UI was not verified in an authenticated browser session. |
| Real-world sources and outreach | NOT EXERCISED | No connected provider or permitted real contact source was available. No calls, texts, emails, or other outreach were sent. Product remains not proven operational. |

No SQL migration or database schema change was required; contact evidence remains in the existing persisted JSON records. Existing source restrictions and buyer/seller consent gates are unchanged.

**Next single task:** verify buyer contact-research role denial through the actual HTTP route and review one real, permitted seller/buyer contact route with an owner session; keep any outreach `NOT_SENT`.

## Block 38 — Seller Call-Ready Packet and Outcome-to-Workflow Handoff — 2026-10-15

**State: PARTIAL — packet assembly and persisted outcome handoff are implemented and synthetically exercised; authenticated UI review and real permitted contact/call evidence remain unverified.**

- The existing Call Next view now assembles a compact seller packet from the current queue item, lead detail, and persisted calls: source-linked verified property facts; a separate AI-hypothesis label; current deterministic ARV/repair/MAO assumptions with calculation time, risks, and formula; missing questions; selected phone route source, observed time, confidence, permission and freshness; and the two latest human-entered call notes with actor, outcome, timestamp, note, and next action.
- The packet does not promote hypotheses or seller statements to verified facts. Estimates are explicitly underwriting assumptions, not seller statements or authority. Contact identity and signing authority remain distinct and unverified unless separately reviewed.
- Structured call outcomes continue through the persisted `recordCall` transaction: operator notes and outcome are append-only; connected outcomes create indicated evidence linked to the call; follow-up time and next action are saved and audited; exact keyed retries are idempotent, changed-content retries and stale lead versions are rejected. Note extraction remains source-anchored and editable.
- Deterministic underwriting inputs are asserted unchanged by a call capture. Material seller evidence can invalidate stale pre-execution analysis/authority for human review; it is not copied into economics. No automated call or outreach is performed.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Persisted call packet and outcome exercise | PASS | `pnpm --filter @workspace/api-server run exercise:acquisition-queue` passed in an isolated persisted schema. It verified linked verified-fact and contact source URLs/timestamps, model-source label boundaries, note persistence/reload, exact replay deduplication, altered replay and stale-version rejection, call evidence linkage, audited follow-up, and unchanged underwriting inputs. All exercise records were synthetic. |
| Deal-domain tests | PASS | `pnpm --filter @workspace/deal-domain run test` passed 128/128, including the existing call-brief hypothesis, question, and no-price-authority behavior. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed for shared libraries, API, web, mockup sandbox, and scripts. |
| Builds | PASS with warnings | API build and web build passed. Web emitted existing source-map lookup warnings and a >500 kB bundle warning. |
| Authorization and real provider/source | PARTIAL / NOT EXERCISED | Persisted exercise rejects viewer call-session start and stale edits. No real provider, permitted live contact route, owner session, or actual call was available. |
| Signed-in UI | NOT VERIFIED | Preview browser is unauthenticated and only shows the sign-in landing page; the assembled packet was not inspected in an owner session. |

No API schema, database schema, or migration change was needed for this client-side assembly; the outcome workflow uses existing persisted call, evidence, audit, and follow-up records. The operating system is not proven fully operational.

**Next single task:** verify the call packet and outcome handoff in a legitimate owner session against the actual protected routes, while keeping real calls and outreach disabled until contact identity and channel permission are proven.

## Block 39 — Offer Readiness Scorecard and Missing-Evidence Gates — 2026-10-15

**State: IMPLEMENTED; authenticated UI and live legal/provider evidence remain unverified.**

- Offers now show a deterministic, weighted 0–100 evidence scorecard covering property identity, seller authority, contactability, comparable sales/ARV, repair assumptions, transaction costs, current deterministic MAO, legal/strategy review, and active exact-version owner approval.
- Each criterion reports its state, supporting evidence where available, specific missing/stale evidence, and a next action. Stale contact routes, stale analysis, missing source/authority, incomplete economics, unreviewed legal strategy, and lack of exact-version approval remain visible blockers or review requirements.
- Missing deal-specific legal/strategy review is explicitly marked as a hard stop. The score is informational: it never grants authority, changes deterministic underwriting, changes offer terms, or bypasses existing draft/owner-approval/communication validation. Existing API hard gates remain in force.
- The score is calculated from fixed criterion weights and assessment states; monetary offer amount is not an input. Complete criteria score 100; review-required criteria receive half credit; blocked criteria receive zero. This score does not mean an offer is ready to send.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Readiness calculator tests | PASS | Deal-domain test suite passed 131/131, including repeatability, hard-stop behavior, explicit missing/stale evidence and remedies, score/economics invariance, and non-authorization. |
| Persisted calculation exercise | PASS | `pnpm --filter @workspace/api-server run exercise:offers` passed in an isolated persisted schema. The score was calculated from persisted synthetic offer, lead, authority-evidence, underwriting, and contact-research records; unreviewed contact permission and unreviewed legal strategy remained hard stops despite an active owner approval. Analyst authorization remained denied. No real offer was communicated. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed for shared libraries, API, web, mockup sandbox, and scripts. |
| Builds | PASS with existing warnings | API and web builds passed. Vite reported source-map lookup warnings and a >500 kB bundle warning. |
| Signed-in UI / real evidence | NOT VERIFIED | No legitimate owner session or real permitted legal/contact evidence was available. The scorecard is not verified in an authenticated browser session. |

No API contract, database schema, or migration changes were needed. The scorecard consumes the existing lead detail, current contact readiness, underwriting snapshot, and offer approval state.

**Next single task:** review the scorecard in a legitimate owner session and validate that property/comp/repair evidence freshness and jurisdiction-specific legal review are represented correctly for one permitted real deal before relying on it.

## Block 40 — Buyer Buy-Box Intake and Verification Experience — 2026-10-15

**State: IMPLEMENTED for intake and re-verification presentation; real identity/funds proof and authenticated owner review remain unverified.**

- Buyer intake now explicitly labels target markets, property types, purchase price band, condition tolerance, funding preference, and closing timeline as buyer-reported `INDICATED` preferences. The form explains that edits invalidate current buying/criteria approval and trigger rematching.
- The buyer detail screen separates buyer-reported profile fields from owner-reviewed identity, current buying, criteria, and proof-of-capacity evidence. It shows a step-by-step current/missing checklist with next action, distinguishes preferred funding methods from evidenced methods and available funds, and displays channel permission and expiry as a separate outreach gate.
- Evidence expiration, stale verification, changed identity/criteria, and pending re-verification continue to block approval/matching. Synthetic fixture sources now produce a qualification blocker, cannot receive an `APPROVED` qualification status, remain visibly labeled in the UI, and stay excluded from matching/live demand.
- The human verification form calls out its owner-review boundary and labels available capacity as the amount shown by proof. No bank/identity automation was added and no source, consent, or funds evidence was fabricated.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Buyer qualification/matching tests | PASS | `pnpm --filter @workspace/deal-domain run test` passed 132/132, covering duplicate/conflicting identities in the persisted exercise, synthetic-fixture exclusion, freshness, contact permission separate from match fit, proof-method vs preference, stale/current buyer evidence, and unchanged matching behavior for contact permission. |
| Persisted buyer exercise | PASS | `pnpm --filter @workspace/api-server run exercise:buyers` passed with isolated synthetic database records: exact duplicate and conflicting-route rejection, owner-only verification/permission, missing capacity proof and missing evidenced method rejection, freshness expiry/re-verification, criteria change invalidation, and persisted permission/history reload. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed for shared libraries, API, web, mockup sandbox, and scripts. |
| Builds | PASS with existing warnings | API and web builds passed. Vite reported source-map lookup warnings and a >500 kB bundle warning. |
| Real identity/funds proof and signed-in UI | NOT VERIFIED | The exercise uses synthetic records only. Preview authentication has no legitimate owner session; no real identity, bank, or contact-permission evidence was reviewed. |

No database migration or OpenAPI change was needed. Existing persisted buyer evidence, verification history, permission history, qualification gates, and matching rules were reused.

**Next single task:** review the buyer checklist and re-verification workflow in a legitimate owner session, validating one permitted buyer’s source-backed capacity, criteria evidence, and separate contact permission before using the buyer pool.

## Block 41 — Buyer Distribution Approval, Delivery, and Interest Tracking — 2026-10-15

**State: PARTIAL — delivery truth and exact-message approval invariants are covered by service-level checks, but durable approval/outbox APIs and provider submission are not implemented. No email or SMS was sent.**

- Existing distribution remains bound to an owner-authorized immutable packet, current buyer match eligibility, redacted bearer links, portal response events, and the existing concurrent commitment guard. Portal access is not delivery; interest/acceptance remains separate from a signed owner-reviewed commitment.
- Added a provider-neutral exact-message approval fingerprint binding recipient, channel, packet version/snapshot, exact message content hash, approver, and approval time. Current channel-specific permission and a connected channel-capable provider are required before provider submission can be considered ready.
- Added provider-event reduction rules: delivery requires a matching provider-accepted message ID; exact callback replay is idempotent; an event ID reused with changed content is rejected. Provider acceptance is not represented as delivery or buyer commitment.
- The distribution panel now visibly says delivery is `NOT SENT`, identifies that email/SMS providers are disconnected, and warns that copied links and portal access do not prove sent/delivered status or buyer intent.
- The user selected both email and SMS, then dismissed the provider-connection card and asked to continue without integration. Accordingly, no provider was registered and no outbound contact was attempted. Current buyer permission records remain required independently for each channel.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Buyer outreach and distribution delivery unit tests | PASS | `pnpm --filter @workspace/api-server run test:buyer-outreach` passed 6/6, including exact message/snapshot binding, stale approval rejection, no submission without approval/permission/provider, callback replay/conflict, and accepted-vs-delivered separation. |
| Persisted synthetic transaction exercise | PASS, limited | `pnpm --filter @workspace/api-server run exercise:transactions` passed against an isolated persisted schema. The exercise built a message approval against the persisted redacted packet snapshot, rejected a changed packet version and providerless submission, exercised duplicate provider callbacks, and confirmed locked buyer economics stayed unchanged. The approval/callback state itself is currently a service-level reducer and is not stored as a production recipient record. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed across shared libraries, API server, web app, mockup sandbox, and scripts. |
| API server build | PASS | `pnpm --filter @workspace/api-server run build` passed. |
| Web build | PASS with existing warnings | `PORT=20639 BASE_PATH=/ pnpm --filter @workspace/radical-deal-os run build` passed. Existing source-map and large-chunk warnings remain. |
| Provider submission / delivery | NOT EXERCISED | No Resend/Twilio connection was authorized. There is no production provider adapter, durable outbox, or authenticated provider callback endpoint; all real outbound status remains `NOT_SENT`. |
| Signed-in UI | NOT VERIFIED | No legitimate owner session was available. The preview browser is unauthenticated; visual changes were not verified in an owner session. |

No OpenAPI or database schema change was made. The current implementation does **not** yet persist exact-message approvals or per-channel provider delivery history, and manual link sharing remains distinct from a provider-confirmed send. Do not describe Block 41 as fully complete or the product as operational.

**Next single task:** add durable per-recipient message draft/approval/outbox records and authenticated provider-event ingestion, then validate those endpoints and UI with no sends until a channel provider is authorized.

## Block 42 — Contract Data Assembly and Clause Review Workflow — 2026-10-15

**State: PARTIAL — an immutable, provenance-linked contract review package is now assembled; a qualified legal-clause approval workflow and verified-party records are still missing. No document was sent or signed.**

- The existing purchase-terms PDF now has a second contract-data assembly page. It records the immutable assembly version/hash, source references for property and seller-on-file fields (explicitly `RECORDED_UNVERIFIED`), exact authorized-offer source, underwriting snapshot source, property-location-based checklist scope, purchase-template status, required disclosures, missing data, and signature-routing blockers.
- The package marks seller identity and signing authority as missing unless independently supported; the current code path has no verified legal-party evidence input, so those items remain blockers. It also identifies the acquisition entity, legal description, escrow/title details, current jurisdiction-approved purchase form, and a connected signature provider as unresolved requirements.
- The second page states that property location is checklist scope only, not a legal determination. It states special clauses are not generated or inserted, and owner-proposed text stays unreviewed pending qualified jurisdictional review and separate human approval.
- Existing immutable PDF content hashes and transaction-document history are preserved. Material offer/underwriting or seller-party changes use the existing stale-document gate; no legal approval or signature status is inferred.
- Existing special-clause request handling remains owner-only, idempotent, audited, and explicitly unreviewed. It blocks clause insertion without template/review evidence, but does not yet provide the requested qualified legal-review plus separate human-approval action. Do not describe a proposed clause as approved.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Contract data assembly unit tests | PASS | `pnpm --filter @workspace/api-server exec tsx --test src/services/transaction-documents.test.ts` passed 3/3: source provenance and epistemic labels, missing-party/template/signature blockers, disclosure contents, and hash changes on terms/version changes. |
| Persisted contract-document exercise | PASS | `pnpm --filter @workspace/api-server run exercise:transactions` passed in an isolated persisted schema. It verified the two-page review PDF, saved assembly/source metadata and immutable hashes, owner/operator vs analyst access, unchanged economics, changed-party staleness, and no signature/execution promotion. All data was synthetic. |
| Clause-request role/audit exercise | PASS, limited | `pnpm --filter @workspace/api-server run exercise:clause-review` passed: owner-only request, source-jurisdiction check, idempotent replay, one audit event, and no clause auto-insertion. It confirms requests stay `NOT_REVIEWED`; no approval workflow was tested because none exists yet. |
| OpenAPI code generation | PASS after reverting rich metadata schema | `pnpm --filter @workspace/api-spec run codegen` passed with the existing contract. Adding nested document assembly metadata to the shared generated response hit TypeScript `TS7056`; rich data is kept in the immutable PDF/JSON artifact instead of expanding the broad shared response. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed across shared libraries, API server, web app, mockup sandbox, and scripts. |
| Builds | PASS with existing warnings | API build passed. Web build passed with existing source-map and large-chunk warnings. |
| Verified parties, qualified legal approval, real template/signing | NOT VERIFIED / NOT IMPLEMENTED | No source-backed verified legal-party evidence, legal reviewer approval action, active local approved agreement template, or connected signing provider was available. The resulting artifact is an internal review copy only. |
| Signed-in UI | NOT VERIFIED | No legitimate owner session was available; browser preview is unauthenticated. |

No database migration was required; the assembly is saved within existing document artifact JSON and in the review PDF. The shared OpenAPI document schema was left unchanged to avoid widening the generated aggregate type. Block 42 is not fully complete.

**Next single task:** add owner-recorded legal-review evidence and distinct human approval for special clauses, and introduce verifiable party-identity/authority evidence before any package can become eligible for signature routing.

## Block 43 — Deadline Calendar and Deal Exception Escalation — 2026-10-15

**State: PARTIAL — the authenticated command-center action queue now projects seller follow-ups, current transaction milestone dates, and recorded closing terms; dedicated persistent reminder controls and full buyer/signature coverage remain unimplemented.**

- Calendar actions are derived only from persisted seller `followUpAt`, current terms-matched transaction schedules, and the contract’s recorded closing date. Milestones retain date-only values and the explicitly reviewed IANA zone; closing instants remain timestamps.
- Stable action IDs include the source record/date or contract schedule version/milestone, preventing duplicate rows on repeated command-center loads. Overdue dates receive higher queue priority. Stale schedule hashes produce a re-review action with no stale due date. Closed/cancelled contracts and closed seller leads are excluded; recorded milestone completion removes that milestone reminder.
- Calendar actions are read-only: they preserve source evidence references, do not mark milestones complete, do not send outreach, and respect the existing owner/operator boundary. Existing transaction exceptions and evidence records remain the resolution/audit source.
- This is not yet a dedicated persisted calendar entity. Snooze, cancel, and reschedule actions with calendar-specific audit history are not implemented. Buyer follow-up dates and explicit signature deadlines are not included; no deadline is invented when the source has none.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Deadline/time-zone tests | PASS | `pnpm --filter @workspace/api-server run test:transaction-readiness` passed 5/5, including America/New_York calendar-date handling across daylight-saving boundaries, invalid/upcoming/overdue states, stale terms, idempotent review hashes, and schedule completeness. |
| Persisted calendar exercise | PASS, synthetic | `pnpm --filter @workspace/api-server run exercise:transactions` passed in an isolated persisted schema. Added assertions verify one stable title-milestone item, one recorded closing-date item, owner visibility, analyst exclusion, and no actions after terminal closure. The exercise also persists/replays schedules, rejects stale sources, and records milestone resolution evidence. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed for shared libraries, API, web, mockup sandbox, and scripts. |
| Builds | PASS with existing warnings | API build passed after the final server change. Web build passed; it reports existing source-map and large-chunk warnings. |
| Real calendar data / signed-in UI | NOT VERIFIED | All persisted exercise records are synthetic; no legitimate owner session was available to verify the authenticated calendar action queue. |

No schema migration or OpenAPI change was required; the calendar rows are projections of existing persisted records and use the existing command-center action response. Block 43 is not fully complete.

**Next single task:** persist calendar-specific snooze/reschedule/cancel and evidence-backed resolution events, then include eligible buyer follow-ups and explicitly recorded signature deadlines without generating dates or outreach.

## Block 44 — Data Quality Repair and Safe Backfill — 2026-10-15

**State: PARTIAL — a deterministic, read-only quality-report core is implemented and exercised on an isolated persisted fixture; live cross-domain scanning and reversible repair/backfill are not implemented. No workspace records were changed.**

- Added a report core that accepts normalized records across property, lead, contact, buyer, underwriting, outreach, package, and deal categories. It can identify exact-key duplicate clusters (review only, never merged), missing provenance, dangling references, expired evidence, stale snapshot hashes, and stage-history edges not permitted by a caller-supplied transition policy.
- Reports are dry-run only, include per-entity count reconciliation and a deterministic snapshot hash, and do not write or repair records. Ambiguous duplicate groups retain all record IDs. Transition findings require an explicit allowed-transition policy; the scanner does not guess the stage graph.
- The isolated exercise inserted one synthetic lead in a per-exercise database schema, ran the report twice, reconciled the count, and confirmed the persisted row was unchanged. No real workspace dataset was scanned.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Data-quality report tests | PASS | `pnpm --filter @workspace/api-server run test:data-quality` passed 2/2: deterministic dry-run/count reconciliation, conflict retention, missing provenance, orphan reference, stale evidence/snapshot, policy-based impossible transition, and no input mutation. |
| Persisted fixture exercise | PASS, synthetic only | `pnpm --filter @workspace/api-server run exercise:data-quality` passed in the isolated schema: one inserted fixture, one dry-run issue, matching expected/actual count, repeated report hash, and zero changed rows. |
| Workspace typecheck | PASS | `pnpm run typecheck` passed across shared libraries, API, web, mockup sandbox, and scripts. |
| API build | PASS | `pnpm --filter @workspace/api-server run build` passed. |
| Live scans, repair application/reversal, permissions, cross-domain counts | NOT IMPLEMENTED / NOT VERIFIED | The report core is not yet wired to live repositories or an authenticated owner-only API. It has no repair ledger, apply/backfill, reversal, or permission tests. No property/contact/buyer/underwriting/outreach/package/deal records were mutated or reconciled. |

No schema migration or OpenAPI change was made. Block 44 is not complete; the dry-run core is not a live data repair tool.

**Next single task:** connect the report to read-only persisted repositories, then add owner-authorized, exact-version, audited repair entries with captured before/after values and reversal before enabling any backfill.

## Block 45 — End-to-End Operator Usability and Failure Recovery — 2026-10-15

**State: PARTIAL — the highest-risk call-session retry path now recovers safely without duplicate audit events; the full authenticated operator journey and live provider-failure paths remain unverified.**

- Audited the existing operator route from the command center into source research, seller call, offer, buyer pool, transaction, deadline and close work. Existing source-research and query errors already expose retry/refetch; offer/call forms retain entered values on errors; transaction and buyer workflows have persisted blockers and next actions.
- Improved call-session recovery. Queue selection and call-session-start audit writes now deduplicate exact retries under the lead lock and return the original persisted timestamp. The Calls screen offers safe retry for transient errors; stale-version conflicts refresh the current queue/evidence first, while authentication/authorization failures do not show a futile retry button.
- No offer, buyer decision, signature, message, funds movement or stage transition is performed by a retry. The call-session event explicitly records that no call was placed. Existing source, underwriting, offer, package, buyer, contract and closing persistence remains authoritative; no duplicate data-entry flow was added.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Call-queue/operator recovery exercise | PASS, synthetic | `pnpm --filter @workspace/api-server run exercise:acquisition-queue` passed. It verifies call readiness permissions, replay-safe queue selection/session start with exactly one audit event, stale-version rejection, persisted notes/follow-ups, route/underwriting blockers and unchanged offer/economics boundaries. |
| Offer/contract/deadline/closing workflow | PASS, synthetic | `pnpm --filter @workspace/api-server run exercise:transactions` passed the persisted lifecycle through offer authority, document/package readiness, milestone evidence, buyer funds, deadlines, terminal close, and post-close guards. |
| Buyer workflow | PASS, synthetic | `pnpm --filter @workspace/api-server run exercise:buyer-pool` passed buyer pool persistence, verification/permission gates, matching and task behavior; no real workspace prospect was seeded and no communication was sent. |
| Seller portal/provider-style failure transitions | PASS, synthetic | `pnpm --filter @workspace/api-server run exercise:seller-offer-portal` passed API checks for auth failures, conflict/replay rejection, rate limits, owner recovery, and persistent response history. No external message was sent. |
| Workspace typecheck and builds | PASS with existing web warnings | `pnpm run typecheck` passed. API and web builds passed; Vite reports existing source-map lookup and large-chunk warnings. |
| Signed-in UI / real owner and live provider failure | NOT VERIFIED | No legitimate owner session or authorized live provider path was available. The browser preview shows the sign-in page. Synthetic service exercises do not prove the signed-in browser journey or real external-provider recovery. |

No schema migration or OpenAPI change was required. Block 45 is not fully complete: UI verification across each stage, duplicate-entry review beyond call-session start, and real provider outage/recovery behavior remain open.

**Next single task:** exercise the full dashboard-to-close journey in a legitimate owner session and resolve any remaining stage-to-stage handoff dead ends without using real outreach or signatures.

## Block 46 — Release Gate and Highest-Impact Blocker Fix — 2026-10-16

**Release gate: BLOCKED — substantial synthetic/persisted workflow coverage passes, but the dependency audit has an unresolved high-severity advisory and multiple real-world operational gates are unconfigured or unverified. This is not a production-readiness claim.**

### Pass/fail matrix

| Area | Result | Exact evidence |
| --- | --- | --- |
| API and UI unit/security tests | PASS | `pnpm --filter @workspace/api-server exec tsx --test src/services/*.test.ts ../../artifacts/radical-deal-os/src/lib/*.test.ts` — 71 passed, 0 failed. Covers auth/roles, private-route 401s, buyer outreach permissions/delivery truth, work recovery, transaction readiness, provider health, command-center states, and UI state helpers. |
| Deal-domain tests | PASS | `pnpm --filter @workspace/deal-domain test` — 132 passed, 0 failed. Includes underwriting invariants, buyer eligibility, offer authority, evidence freshness, seller-call evidence, deadlines and approval gates. |
| Property-source tests | PASS | `pnpm --filter @workspace/property-sources test` — 22 passed, 0 failed. Includes provenance, provider availability, contact permission, source matching and data validation. |
| Persisted synthetic workflow exercises | PASS | Isolated-schema exercises passed: `exercise:command-center`, `exercise:acquisition-queue`, `exercise:seller-contact-enrichment`, `exercise:property-contact-http`, `exercise:offers`, `exercise:seller-offer-portal`, `exercise:transactions`, `exercise:worker-recovery`, `exercise:outcome-learning`, and `exercise:intelligence-loop`. They cover persisted records, role gates, duplicate/replay safety, failed jobs, offer authority, package/contract/deadline/closing lifecycle, and fixture exclusion. No real seller/buyer outreach, signature, or funds action occurred. |
| Workspace typecheck/build | PASS with warnings | `PORT=20639 BASE_PATH=/ pnpm run build` passed the full typecheck and workspace builds. Existing warnings: web bundle exceeds 500 kB; API bundle is large. The first invocation lacked required `PORT`/`BASE_PATH`; rerunning with the configured values passed. |
| Command-center exercise reconciliation | PASS after test correction | First run failed because the exercise expected no operator action for a lead with an explicitly persisted seller follow-up. The test now asserts that analyst decision work is excluded for the operator while the recorded calendar follow-up is present. The corrected persisted exercise passed; product role filtering was not loosened. |
| Dependency audit | FAIL — release blocker | `runDependencyAudit()` found 1 high and 1 moderate vulnerability: `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, stack-exhaustion DoS) and `postcss-selector-parser@6.0.10` (GHSA-rj75-hqrm-r3gf / CVE-2026-104844). Registry checks show `braces` latest is still 3.0.3, so no patched upstream version is available to apply safely in this slice; `postcss-selector-parser` is fixed in 7.1.6, a major-version update requiring compatibility review. No override or unverified fork was introduced. |
| SAST / privacy-dataflow scan | PASS | `runSastScan()` returned 0 findings; `runHoundDogScan()` returned 0 findings. |
| Application authorization | PASS for tested gates | `test:auth` within the 71-test suite and `exercise:property-contact-http` verify session requirements, owner/operator/analyst/viewer restrictions, sensitive-route denial, and protected data access. This does not substitute for a real signed-in UI review. |
| Permitted live source/provider checks | NOT RUN / UNVERIFIED | No property/contact, email/SMS, signing, closing-coordination, or managed private-storage provider is connected in the current workspace view or readiness evidence. The synthetic transaction readiness report marks these unconfigured/degraded and says no provider request was made. No external source, outreach, signing, or storage operation was attempted without an authorized connection. |
| Owner-session UI and real transaction proof | NOT VERIFIED | No legitimate owner session, real permitted seller/buyer evidence, provider-confirmed delivery, signature, funds, or closing outcome was available. Synthetic exercises are not real-world proof. |

### Highest-impact blocker and disposition

The earliest release blocker is the high-severity `braces@3.0.3` advisory. The direct parents found by `pnpm -r why braces` are `micromatch@4.0.8` via `http-proxy-middleware@4.2.0` and `fast-glob@3.3.3`; the current registry still reports `braces@3.0.3` as latest. A safe upstream fix or compatible replacement is not available from this evidence, so the dependency was not forcibly overridden or replaced. The dependency finding remains open and must be resolved before production readiness can be claimed.

### Verified vs. partial

- **Verified functionality:** deterministic underwriting/offer gates, role-based API protections, persisted synthetic workflow transitions, replay-safe retries, buyer/contact evidence controls, and closing/outcome reconciliation in isolated schemas.
- **Partial implementation:** operational workflows have explicit blockers and manual paths, but provider-backed research, contact discovery, messaging, e-signature, closing coordination, managed private document storage, and jurisdiction-approved templates are not configured.
- **Synthetic-only proof:** all end-to-end persistence exercises and fixture-based lifecycle results listed above.
- **Unverified:** authenticated owner browser journey and all real provider/evidence/transaction outcomes.

**Next single task:** resolve the high-severity `braces` advisory through a patched upstream dependency or a compatible replacement, then rerun the dependency audit and the full verification matrix.

## Block 47 — Source Coverage and Acquisition Refresh Operations — 2026-10-16

**State: IMPLEMENTED for source-operation visibility and synthetic persistence verification; no live source refresh was run in this block.**

- Expanded the Sources screen's existing coverage panel with per-source enabled/unconfigured state, terms-review status, source-specific last attempt and last successful execution timestamps, connector result count and its meaning, freshness, rate-limit/batch notes, surfaced errors, next six-hour eligibility when recurring discovery is explicitly enabled, and a manual next action.
- Source status is derived from persisted `DISCOVER_PROPERTIES` job evidence and the active source-policy version. The UI explicitly says opening the page performs no query; absent connector evidence is shown as no check/no result count, not a successful empty refresh. `PARTIAL`, `FAILED`, `RATE_LIMITED`, and stale states remain distinguishable.
- Exact connector summary counts are labeled connector-level batch counts, not source-row totals or qualified leads. Sources with no per-source execution summary do not receive a fabricated last-success timestamp. Not-connected capabilities remain separately labeled with reasons and manual activation steps.
- Recurrence eligibility is shown only when the latest terms-reviewed source policy explicitly opts into recurring property discovery. A later opt-out removes the schedule. No job was queued and no provider/source was queried by this feature.
- Kept raw observations separate from leads. The synthetic persistence exercise confirms repeated source-key ingestion retains one discovery identity, does not create a lead, and source counts do not promote records.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Source operational coverage exercise | PASS, synthetic persisted schema | `pnpm --filter @workspace/api-server run exercise:property-source-coverage` verifies never-run/no-false-zero, active policy and terms status, connector count parsing, current and stale freshness, rate-limit failure preservation, scheduled eligibility and recurrence opt-out, duplicate source-key ingestion, and no lead promotion. |
| Bounded pagination | PASS | Added an offline guard test: 40 is accepted; zero, fractional, and over-40 page sizes fail before any source request. |
| Retry and rate-limit handling | PASS | `test:worker-recovery` passes bounded backoff and stale-lease tests; the persisted source-coverage exercise confirms HTTP 429 remains visible and does not replace the last successful check. |
| Source and discovery tests | PASS | `pnpm --filter @workspace/property-sources test` — 23 passed; `test:property-discovery-ranking` — 2 passed, including provenance and hypothesis-exclusion behavior. |
| Typecheck/build | PASS with existing warnings | `PORT=20639 BASE_PATH=/ pnpm run build` passed shared-library and app typechecks plus all workspace builds. Existing large web bundle warning remains. |
| Real source refresh / provider availability | NOT RUN / UNVERIFIED | This block only read persisted job telemetry in an isolated schema exercise. No Philadelphia/public source refresh was triggered. Not-connected capabilities remain unqueried; job telemetry is not a live provider health check. |

No new app, schema migration, provider connection, or workflow restart was made. The API contract was updated and code-generated for the operational status response. The existing dependency release blocker recorded in Block 46 remains unresolved.

**Next single task:** exercise one explicitly terms-reviewed Philadelphia source job in a permitted environment, then verify that its persisted per-source success/failure, result count and freshness agree with raw observations without promoting leads.

## Block 48 — Property Contactability and Ownership Evidence Gate — 2026-10-16

**State: IMPLEMENTED for the shared evidence gate and property-discovery CALL_READY transition; synthetic persisted contact-research path verified.**

- Added one shared property contactability gate used by contact-research missing requirements, acquisition contactability coverage, and the CALL_READY transition for leads linked to property discoveries.
- The gate requires a cited source record/URL and evidence reference; an observation no older than 180 days; confidence of at least 0.85; non-prohibited, documented source-use basis; seller self-identification rather than owner-of-record alone; and a current, confirmed, permitted phone route with supporting recipient-identity evidence.
- The gate blocks inferred identity, stale or future-dated ownership evidence, unknown or prohibited permission, conflicting seller/owner claims, stale routes, unverified routes, low confidence, multiple conflicting recipients/roles, synthetic evidence, and postal-only contact data. It returns specific missing requirements, including permitted next research actions.
- Contact-research source categories now distinguish public record/page, owner-supplied, seller-provided, manual research, inferred, and other. Runtime validation rejects unrecognized values. Seller-provided statements and manually researched routes remain evidence inputs, not automatic verification.
- Discovery contactability counts now require both the seller identity/ownership evidence and route gate to pass; having a route alone no longer counts as a current permitted verified seller route.
- Private contact-research details remain behind the sensitive-data role middleware. The isolated HTTP exercise verifies a viewer is denied access, owner-reviewed evidence persists and reloads, replay is idempotent, and unauthorized permission approval is rejected.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Evidence-gate tests | PASS | `pnpm --filter @workspace/api-server exec tsx --test src/services/property-contactability-gate.test.ts` — 4 passed: stale/owner-only/inferred identity, prohibited permission/conflicting identities/duplicate recipients, route permission/freshness/missing-route handling, and seller-provided evidence provenance. |
| Persisted contact-research HTTP exercise | PASS, synthetic isolated schema | `pnpm --filter @workspace/api-server run exercise:property-contact-http` — saved/reloaded route evidence, replay safety, role permissions, and viewer denial; no external source or contact was queried. |
| OpenAPI code generation | PASS | `pnpm --filter @workspace/api-spec run codegen`; generated API clients and Zod schemas compiled. |
| Workspace typecheck and build | PASS with existing warning | `pnpm run typecheck` and `PORT=20639 BASE_PATH=/ pnpm run build` passed. The existing web bundle-size warning remains. |
| Live ownership/provider evidence | NOT RUN / UNVERIFIED | No real owner session or live contact-source refresh was available or used. Synthetic checks do not establish a real seller’s identity, lawful contact basis, title, or signing authority. |

**Next single task:** verify the gated CALL_READY path with a legitimate owner-reviewed property identity/contact case, then separately validate real permitted source evidence before relying on it operationally.

## Block 49 — Acquisition Pipeline Conversion and Stage Definitions — 2026-10-16

**State: IMPLEMENTED as an evidence-derived pipeline projection with guarded transitions and persisted-record reconciliation.**

- Defined the acquisition stages `DISCOVERED`, `NORMALIZED`, `QUALIFIED_FOR_RESEARCH`, `CONTACT_ROUTE_RESEARCHED`, `CALL_READY`, `CONTACTED`, `SELLER_QUALIFIED`, `UNDERWRITING_READY`, `OFFER_READY`, `CLOSED`, `LOST`, and `NURTURE`, with entry and exit evidence definitions returned by the dashboard API.
- Pipeline stage is derived from persisted property discoveries, linked leads, human-entered call outcomes, seller answers, current analysis snapshots, and terminal outcomes. Counts include each lead once or each unlinked discovery once; synthetic/fixture records are excluded and reported separately.
- `CONTACTED` is never inferred from a transition attempt: manual `CALL_READY → CONTACTED` and `CONTACTED → CONVERSATION` edges were removed. `recordCall` persists the human-entered outcome and its audit transition transactionally. The existing idempotency key prevents duplicate call outcomes.
- `SELLER_QUALIFIED` requires a connected human-entered call with at least two seller-answer fields; these remain seller-reported and are not treated as independently verified facts. `NURTURE` requires a no-answer/voicemail/busy outcome plus a persisted future follow-up.
- `CALL_READY` counts only when the lead remains in that stage and the live call queue still considers it callable. `UNDERWRITING_READY` and `OFFER_READY` require a blocker-free underwriting snapshot less than seven days old.
- The dashboard now displays evidence-defined pipeline counts and definitions instead of suggesting progress from lead stage labels alone. Projection is read-only; existing transition, call, discovery, and audit records retain the human reasons and evidence that support each stage.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Stage logic and transitions | PASS | `pnpm --filter @workspace/deal-domain exec tsx --test src/acquisition-pipeline.test.ts src/seller-slice.test.ts` — 18 passed; verifies evidence progression, terminal precedence, human call outcomes, nurture follow-up, manual-transition denial and role authorization. |
| Persisted analytics reconciliation | PASS, synthetic isolated schema | `pnpm --filter @workspace/api-server run exercise:acquisition-pipeline` verifies a normalized persisted discovery count, reconciliation against persisted lead + unlinked-discovery rows, repeat-projection idempotency, and no fabricated transition/backfill history. |
| Call persistence/recovery | PASS, synthetic isolated schema | `pnpm --filter @workspace/api-server run exercise:seller` passed persistence/reload, stale/concurrent write rejection, call readiness, follow-up and immutable evidence checks. |
| Authorization | PASS | `pnpm --filter @workspace/api-server run test:auth` — 8 passed, including role restrictions and sensitive-data route denial. |
| OpenAPI, typecheck and build | PASS with existing warning | `pnpm --filter @workspace/api-spec run codegen`, `pnpm run typecheck`, and `PORT=20639 BASE_PATH=/ pnpm run build` passed. Existing web bundle-size warning remains. |
| Real-world stage validation | NOT VERIFIED | Counts were compared in an isolated persisted exercise only. No owner session or live historical acquisition records were available for real-world reconciliation. |

No schema migration was needed: pipeline stages are derived from the existing persisted source, call, underwriting, offer and transition records; no migration/backfill writes are performed. Existing histories remain authoritative and read-only projection does not rewrite them.

**Next single task:** require explicit decision-authority evidence and seller intent before counting a connected seller as `SELLER_QUALIFIED`, then test that answer edits, missing fields and contradictory answers cannot overstate qualification.

## Block 50 — Deal Economics Scenario and Sensitivity Analysis — 2026-10-16

**State: IMPLEMENTED as a deterministic, read-only scenario analysis alongside the authoritative underwriting result.**

- Added low/base/high scenarios for ARV, repairs, buyer margin reserve, holding + closing costs, assignment fee, and MAO. Scenario MAO follows the underwriting economics formula and rounds to cents; it is floored at zero and never represents an offer price or authority.
- Low uses low ARV, high repairs, high costs, and high assignment fee; high reverses those inputs. The operator-controlled sensitivity width changes only the illustrative holding/closing and assignment envelopes (default ±20%, adjustable 0–100%); it is labeled as an assumption, not observed evidence.
- Added one-input-at-a-time MAO sensitivity for ARV, repairs, costs, and assignment fee. The panel identifies ARV as sourced from eligible comps, repair ranges as estimates with per-line provenance, buyer margin as inferred from policy, and costs/assignment target as configured estimates. Seller/agent-reported inputs remain explicitly reported; missing ARV or repair evidence displays as missing and blocks MAO scenarios instead of treating it as zero.
- Scenario calculations are local/read-only: they do not update underwriting inputs, the authoritative analysis snapshot, deal version, or offer approval. Reviewed underwriting edits continue through the existing version-checked snapshot flow, which invalidates dependent offer approvals.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Formula, sensitivity and boundaries | PASS | `pnpm --filter @workspace/deal-domain test` — 138 tests passed, including low/base/high arithmetic, monotonic sensitivity, cent rounding, zero and maximum uncertainty width, invalid bounds, missing repair evidence, and snapshot immutability. |
| Persisted scenario and approval exercise | PASS, synthetic isolated schema | `pnpm --filter @workspace/api-server run exercise:offers` verifies scenario calculations leave the persisted analysis snapshot and snapshot count unchanged; the existing exercise also verifies approval invalidation after material deal evidence changes. No external offer was communicated. |
| Typecheck and build | PASS with existing warning | `pnpm run typecheck` and `PORT=20639 BASE_PATH=/ pnpm run build` passed. Existing web bundle-size warning remains. |
| Signed-in scenario panel | NOT VERIFIED | Preview loaded the public sign-in page; no legitimate owner session was available to inspect the authenticated lead detail UI. |

No API/schema migration was required; scenario results are calculated from the current analysis in the client and are not stored as authoritative evidence.

**Next single task:** validate the scenario ranges and configured uncertainty width with an owner-reviewed historical underwriting example; retain the existing snapshot and approval boundaries during review.

## Block 51 — Buyer Pool Coverage and Gap-Driven Acquisition — 2026-10-16

**State: IMPLEMENTED as a live verified-coverage view with capacity-aware gap actions.**

- Added a buyer-capacity API response that calculates each buyer's active committed funds and concurrent deal count from persisted contracts. Coverage subtracts both from reviewed funds and the buyer's reviewed maximum concurrent deals.
- The buyer page now reports coverage by observed market, property type, and fixed purchase-price bands, with condition tolerance and closing-speed coverage. Only active, owner-approved buyers with current identity/funding proof, current buying evidence, reviewed criteria, sufficient available funds and open concurrency capacity count.
- Prospects and stale buyers are separate from eligible coverage. Uncovered boxes show current candidate/proof blockers plus an action to add a real prospect; stale reviewed buyers expose a direct re-verification action. No buyer record is fabricated.
- Duplicate email/phone identities block all conflicting records from coverage. Synthetic fixtures are excluded from both coverage counts and from generating the market/type grid.
- The observed market/type grid is derived from non-synthetic buyer criteria, and price bands are fixed buckets. If no real criteria define a market, no guessed market is shown. Gap acquisition cards are derived from current records; qualification/reverification state remains in the existing buyer workflow, not a new durable task ledger.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Coverage, proof and capacity tests | PASS | `pnpm --filter @workspace/deal-domain test` — 141 passed, including coverage freshness, full-band price constraints, duplicate identity exclusion, current proof/funding, reserved funds/deal slots, rehab tolerance, closing speed, and fixture exclusion. |
| Persisted buyer-pool exercise | PASS, isolated PostgreSQL | `pnpm --filter @workspace/api-server run exercise:buyer-pool` passed. It verifies fixture-only self-reported criteria do not create coverage dimensions and persisted capacity reports zero reservations for the isolated prospect. It seeded no real workspace prospect and sent no communication. |
| API generation, typecheck and build | PASS with existing warning | `pnpm --filter @workspace/api-spec run codegen`, `pnpm run typecheck`, and `PORT=20639 BASE_PATH=/ pnpm run build` passed. Existing web bundle-size warning remains. |
| Real buyer-pool accuracy / authenticated UI | NOT VERIFIED | Exercise data was isolated and synthetic; no owner-reviewed production buyer pool or authenticated session was available to validate the visible screen. |

**Next single task:** define operator-owned target markets and make uncovered-box acquisition actions durable, assignable and resolvable, so the grid can reveal gaps beyond markets already present in buyer criteria.

## Block 52 — Offer Negotiation Versioning and Counteroffer Control — 2026-10-16

**State: IMPLEMENTED for explicit human-entered and verified seller-portal counteroffer evidence.**

- Counteroffers are new offer rows, never edits to communicated terms. Each links to a communicated parent, the current underwriting snapshot, seller/property identity, exact terms, conditions and draft expiry. The review hash includes the negotiation lineage and response evidence.
- A counteroffer requires explicit human-entered evidence or a seller portal event with verified one-time-code route control and recorded counter terms. Notes and message-attempt records are not automatically promoted to seller responses.
- Creating a counteroffer revokes the parent's internal authority while preserving its original approval and communication history. The new version starts as a draft and cannot be communicated until the normal exact-review-hash owner approval gate passes.
- Counteroffer commands require an idempotency key. A lead row lock serializes competing versions; identical retries return the same persisted state, and a second distinct command using a stale lead version is rejected. Audit records include parent/version lineage, response source, evidence, economics snapshot, terms, and review hash.
- The existing offer panel now lets an operator choose a communicated parent and enter explicit seller-response evidence. The UI path is human-entered; provider-backed portal events are accepted by the API and still require verified portal provenance.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Offer domain tests | PASS | `pnpm --filter @workspace/deal-domain exec tsx --test src/offers.test.ts` — 14 passed, including exact approval, staleness, role and economics boundaries. |
| Persisted offer exercise | PASS, isolated PostgreSQL | `pnpm --filter @workspace/api-server run exercise:offers` passed. Two competing counteroffer commands from one lead version yielded one winner; same-key replay did not duplicate; changed terms with the same key were rejected; audit lineage was checked; deterministic underwriting remained byte-for-byte unchanged; draft communication was blocked. No external offer was communicated. |
| API generation, typecheck and build | PASS with existing warning | `pnpm --filter @workspace/api-spec run codegen`, `pnpm run typecheck`, and `PORT=20639 BASE_PATH=/ pnpm run build` passed. Existing web bundle-size warning remains. No database migration was needed because offer lineage is stored in the existing immutable payload. |
| Provider-backed counteroffer conversion / signed-in UI | PARTIAL / NOT VERIFIED | Backend validates verified portal event provenance, but the authenticated UI and a real owner session were unavailable; the persisted offer exercise covered the human-entered path. No provider event was converted in this exercise. |

**Next single task:** connect verified seller-portal counter events to the operator draft flow and prove portal-event-to-new-version lineage in a persisted exercise, including stale and duplicate provider callbacks.

## Block 53 — Transaction Readiness and Party/Document Checklist — 2026-10-16

**State: IMPLEMENTED as a per-deal evidence-derived checklist in the existing transaction panel.**

- Added checklist items for party identity, authorized signers, exact approved terms, jurisdiction-specific disclosures, current contract/document version, signatures, title/closing contact, contingencies, earnest money, assignment structure, deadlines, and audit history.
- Status comes from current lead identity/evidence, the exact offer and economics snapshot, contract/document versions, signed-document evidence, recorded milestones, reviewed deadline schedule, and transaction history. There are no manual completion toggles.
- The checklist fails closed: seller name alone does not prove identity; ownership alone does not prove signer authority; terms must match the exact authorized offer; signature completion requires both timestamps and executed-document evidence; earnest money requires matching amount and receipt evidence; assignment remains blocked without required proof.
- Applicable disclosures always remain `REVIEW_REQUIRED` until qualified jurisdiction-specific review is evidenced. Title/escrow contact remains missing because no structured verified contact field is present; the checklist names that next step rather than inferring one from a note.
- Deadline entries require a persisted five-item schedule, source, valid IANA time zones, parseable due dates, and dates no later than the recorded closing date. Existing server checks continue to detect stale schedules against changed terms.
- Existing protected deal-operations access is reused; no new mutation endpoint or manual checklist override was added.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Checklist unit coverage | PASS | `pnpm --filter @workspace/deal-domain test` — 144 passed, including missing party/signer evidence, changed approved terms, document version mismatch, signatures, deadline/time-zone validity, audit history, and legal-review status. |
| Persisted transaction exercise | PASS, isolated PostgreSQL | `pnpm --filter @workspace/api-server run exercise:transaction-readiness` passed the full lifecycle persistence exercise and asserts absent identity/signature evidence remains incomplete and disclosures remain under qualified review. |
| Deadline and authorization checks | PASS | `pnpm --filter @workspace/api-server run test:transaction-readiness` — 5 passed; `pnpm --filter @workspace/api-server run test:auth` — 8 passed, including denial of viewer access to sensitive transaction routes. |
| Typecheck and build | PASS with existing warning | `pnpm run typecheck` and `PORT=20639 BASE_PATH=/ pnpm run build` passed. Existing web bundle-size warning remains. |
| Authenticated checklist UI | NOT VERIFIED | Preview redirected to sign-in; no legitimate owner session was available to inspect the signed-in deal panel. |

**Next single task:** capture verified title/escrow contacts and qualified disclosure decisions as structured deal evidence so those checklist items can be completed from auditable records rather than remaining permanent blockers.

## Block 54 — Operational Notifications and Actionable Alerts — 2026-10-16

**State: IMPLEMENTED as durable, in-app alerts in the command center.**

- Added persisted alert records keyed by their source action, preventing repeated command-center refreshes from creating duplicates. Alerts sort by source priority and link to the lead or worker record that needs action.
- Alert candidates are derived from role-filtered command-center actions, persisted open transaction exceptions, and failed worker jobs. This covers actionable follow-ups, buyer-verification and research work, transaction delivery/signature/funds/deadline exceptions, unresolved deal exceptions, and worker/provider failures when those source records expose them.
- Owners and operators can snooze an alert for up to 30 days or dismiss it. Snooze expiry reactivates it; when its source action disappears, the alert becomes resolved. Dismissal and snooze are written to the audit log. Analysts are denied state changes.
- Alert reads are role-scoped to the action's responsible role; owners can review the whole workspace. Analysts can read their assigned alerts but cannot dismiss or snooze them.
- Alerts are in-app only. No email, SMS, push, or other external-send integration was added or invoked. Provider configuration and external-notification approval remain absent.
- Coverage is limited to records currently surfaced as command-center actions, persisted transaction exceptions, or failed jobs. A state that those sources do not expose will not produce an alert; no independent alert scanner for every underlying domain record was added in this block.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Persisted alert exercise | PASS, isolated PostgreSQL | `pnpm --filter @workspace/api-server run exercise:alerts` passed deduplication, priority order, snooze expiry, analyst denial, dismissal, source resolution, audit entries, and no outbound delivery path. |
| Authorization | PASS | `pnpm --filter @workspace/api-server run test:auth` — 8 passed; service-level persisted exercise also verifies analyst alert-state changes are rejected. |
| Database schema | PASS | `pnpm --filter @workspace/db run push` applied the additive alert-table schema. |
| API generation, typecheck and build | PASS with existing bundle warning | `pnpm --filter @workspace/api-spec run codegen`, `pnpm run typecheck`, and `PORT=20639 BASE_PATH=/ pnpm run build` passed. |
| Running app | PASS, signed-in UI unverified | API workflow restarted and is listening; preview screenshot shows the sign-in page because no owner session was available. |

**Next single task:** extend alert derivation to domain states that are not yet surfaced by command-center actions or persisted transaction exceptions, then add source-specific persisted tests for each newly covered alert family.

## Block 55 — Audit Trail, Evidence Export, and Deal Handoff — 2026-10-16

**State: IMPLEMENTED as a versioned JSON export from the existing lead detail view.**

- Added a purpose selector and a download action for internal review, title handoff, legal review, and buyer handoff. The API produces a JSON attachment from a single locked lead snapshot.
- The packet contains the deal/source-lineage reference, current and historical underwriting snapshots, calls and intelligence, buyer matches and verification records, offers, distribution packages/recipient events, contracts, transaction history, worker/provider jobs, and open transaction exceptions. Empty sections remain explicit when a deal has no records of that type.
- Each export is stored as an immutable version with actor, timestamp, purpose, redaction level, and SHA-256 content hash. Subsequent exports include prior-export metadata; they do not rewrite earlier snapshots.
- Sensitive address/contact fields are redacted by default and scrubbed from free-text history. Private tokens, PDF byte payloads, and secrets remain excluded even from authorized exports. Full sensitive fields require an owner, `OWNER_AUDIT` purpose, and explicit `includeSensitive=true`. Other roles cannot access that mode.
- Synthetic status is carried only from explicit fixture flags; related child records inherit a synthetic lead's classification. Unmarked records are labeled unmarked, not asserted to be real.
- Purpose is recorded and controls whether sensitive fields can be exported; recipient identity itself is not independently verified by this feature.

| Verification | Result | Exact evidence / limitation |
| --- | --- | --- |
| Persisted export exercise | PASS, isolated PostgreSQL | `pnpm --filter @workspace/api-server run exercise:transaction-readiness` passed assertions for underwriting/call/offer/contract sections, synthetic classification, full vs redacted address/phone, viewer denial, version increment, SHA-256 format, deal-version consistency, and unchanged prior snapshot after a later export. |
| Database schema | PASS | `pnpm --filter @workspace/db run push` applied the additive immutable export table. |
| API generation, typecheck and build | PASS with existing bundle warning | `pnpm --filter @workspace/api-spec run codegen`, `pnpm run typecheck`, and `PORT=20639 BASE_PATH=/ pnpm run build` passed. The evidence-packet endpoint is hand-wired rather than represented in generated API contracts because Orval emitted duplicate parameter exports for that route; this remains an API-documentation gap. |
| Authenticated UI | NOT VERIFIED | The preview redirected to sign-in; no legitimate owner session was available to test the download through the signed-in UI. |

**Next single task:** bind handoff purpose to an explicitly selected, permission-checked recipient and validate export scope against that recipient's role before delivery.

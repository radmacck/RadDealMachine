# Real-estate operating-system build checkpoint

**Checkpoint date:** 2026-10-08  
**Current gate:** P2 — permitted property-source coverage  
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
| **P3** | Seller contactability: replaceable provider states, provenance/identity/route/permission/freshness/conflict, idempotent bounded enrichment, safe manual evidence, and fail-closed CALL READY. | Existing foundation; no direct-contact provider currently proven. |
| **P4** | CALL NEXT and seller intelligence: ranked brief and evidence classes; immutable call notes with source/time/operator; reconciliation without overwrites; material changes invalidate stale economics; permitted listing descriptions become source-linked clues/questions. | Existing foundation; live authenticated workflow remains unverified. |
| **P5** | Underwriting: deterministic comps/ARV, condition-based repair ranges, costs, MAO/offer ranges, approved limits, assignment fee and buyer price, risk classification, explicit missing-input work, snapshot versioning and invalidation. | Deterministic foundation and synthetic exercise reported; live property economics remain unproven. |
| **P6** | Buyer demand: prospects remain unverified until current evidence; structured criteria, funding/capacity, source/confidence/last-verified/version, stale downgrade, and explainable matching. | Foundations exist; no live approved/current buyer pool or outreach provider proven. |
| **P7** | Distribution/commitment: identical immutable buyer-safe packet to selected current buyers; address redaction; delivery/view/interest tracking; first valid qualified commitment only after all gates; concurrency, expiry, replacement, release, and amendment history. | Partial; live distribution/commitment remains unverified. |
| **P8** | Contracts/signing: jurisdiction-approved templates, private managed storage, replaceable signing provider, stale-snapshot protection, and truthful document states. | Provider/template/storage boundary exists; no approved template or signing provider proven. |
| **P9** | Funds/closing: EMD and funds evidence, deadlines, title/inspection/closing tasks, amendments, party changes, replacement/expiry, exceptions, closing proof, and time validation. | Partial; real transaction evidence remains unverified. |
| **P10** | Command center: authenticated action-centered CALL NEXT / WHY / NEXT, ranked opportunities, blockers/evidence/economics/deadlines/matches/exceptions, complete paginated pools, and no repeated manual hunting/re-entry. | Foundations exist; authenticated browser verification and owner acceptance remain unverified. |
| **P11** | Outcome learning: persist outcomes and predicted-vs-actual performance; calibrate only from sufficient real evidence with rule/confidence versions; exclude synthetic fixtures from live learning. | Incomplete. |
| **P12** | End-to-end live proof: permitted discovery through contact, seller conversation, refreshed underwriting, authorized offer, current buyer, confirmed distribution/commitment, approved documents/signature, funds/deadlines/closing, and outcome. Label every synthetic step; never count one as live proof. | Incomplete; no GREEN claim until evidenced end to end. |

## Resume rule

Work one vertical slice at a time, beginning at the earliest non-verified priority. If a required provider or source is unavailable, persist and report that boundary truthfully while continuing only with independent work that can be proven.

## Latest verification checkpoint

- Development schema push applied successfully; no production database was changed.
- `pnpm run typecheck:libs`, API typecheck, and web typecheck passed.
- API build passed.
- Web build passed with the artifact's required local `PORT` and `BASE_PATH`; only existing source-map/chunk-size warnings were emitted.
- API workflow restarted and reported `Server listening`; web and component-preview workflows remained running.
- Persisted exercises passed: decision-work lifecycle and gap-aware intelligence loop. Both exercises use isolated cloned schemas and explicitly synthetic records; neither is live deal-flow proof.
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

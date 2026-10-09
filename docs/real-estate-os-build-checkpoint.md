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
| **P2** | Property discovery: retain permitted Philadelphia OPA, L&I violations, unsafe buildings, vacancy, permits, and demolition feeds; pagination, dedupe, all observations, freshness, explainable relevance, and no automatic lead promotion; expand only to sources actually permitted and exercised. | **Next open gate.** Existing discovery foundation remains; wider listing/foreclosure/tax/probate coverage is unproven or unavailable. |
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

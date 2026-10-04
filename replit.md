# Radical Deal OS

Internal wholesaling operating system connecting research, seller conversations, owner-approved offers, qualified buyers, recorded contracts and evidenced closing.

## Run & Operate

- Start the registered artifact workflows for frontend and API; they inject the managed port and route configuration.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM API bundle), Vite web frontend

## Where things live

- `lib/deal-domain` — deterministic underwriting, provenance, permissions, readiness and buyer fit.
- `lib/api-spec/openapi.yaml` — API contract; regenerate, never hand-edit generated hooks and validators.
- `lib/db` — persisted domain records and audit history.
- `artifacts/api-server/src/services` — transactional commands and leased workers.
- `artifacts/radical-deal-os/src` — existing authenticated web experience and reusable forms.

## Architecture decisions

See `.agents/memory/MEMORY.md` and its topic files for durable product direction and authority decisions. Keep authentication in place during testing.

## Product

The command center derives actionable work from live state and role. Seller work, financial approval, buyer qualification, transaction milestones and outcome reconciliation have connected views.

Public Census geocoding observes address geography, not ownership or comps. Philadelphia OPA provides sourced public property observations and unverified sale/corporate-owner candidates, not nationwide coverage or buying/title verification. Managed OpenAI prepares bounded, source-linked hypotheses and questions using Replit credits. It sends no messages and performs no signatures or funds transfers. Broad listing/comparable feeds and automated bank/ownership verification are not connected.

Buyer discovery never means approval. Current buying and reviewed criteria have separate dated evidence; stale evidence blocks matching and creates persistent re-verification work. Deal-finder/guru destinations cannot commit or close as the acquisition buyer. See `docs/requirements-checklist.md` for implementation, evidence and remaining acceptance levels.

## User preferences

Canonical user direction is maintained in `.agents/memory/build-direction.md`.

## Gotchas

- Run `test:auth`, `test:research` and `lib/deal-domain` tests, then the API's `exercise:seller`, `exercise:offers`, `exercise:buyers`, `exercise:transactions` and `exercise:research` scripts.
- Service exercises use isolated PostgreSQL schemas. Do not exercise owner claims, paid-provider fixtures or transaction outcomes against real workspace records.
- Research exercise makes actual Census/OpenAI calls on conspicuously synthetic input and uses credits.
- Screenshot capture is anonymous. Do not claim signed-in UI was verified from it or add an authentication bypass.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

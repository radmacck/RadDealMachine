---
name: Domain interoperability
description: Why reusable financial domain contracts keep calendar dates and timestamps as distinct string values
---

Keep API and reusable domain dates in their wire representations: `YYYY-MM-DD` for calendar dates, ISO timestamps for instants. Convert to native dates only at persistence/explicit arithmetic boundaries.

**Why:** Generated Zod date coercion can silently turn wire strings into Date objects while the generated browser client still expects strings. Serializing a comp sale date as a datetime also breaks calendar-only calculations. Shared domain adapters must have one predictable contract.

**How to apply:** Check generator date settings when adding endpoints. Regenerate, then validate an actual request/response round trip, especially comp sold dates, evidence captured times and follow-up instants. Do not patch generated files or coerce calendar dates into timezone-shifted instants.
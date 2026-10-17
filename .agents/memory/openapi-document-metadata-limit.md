---
name: OpenAPI aggregate response type size limit
description: Keep new workflow payloads out of broad generated command-center responses when they push TypeScript serialization over its limit.
---

Deeply extending nested OpenAPI response trees can expand inferred `GetCommandCenterResponse` beyond TypeScript's serialization limit (`TS7056`) during code generation/typecheck. Keep new workflow data behind a focused endpoint rather than adding it to the aggregate command-center object.

**Why:** The broad aggregate response composes many nested schemas; even a small new nested collection can push its generated type over the compiler limit. Orval can finish generation while its chained library typecheck fails.

**How to apply:** Keep rich or independent workflow data behind focused endpoints. If the aggregate response itself still triggers TS7056, use a mapped `ZodObject` type annotation that preserves accessed `.shape` members, then rerun library and artifact typechecks. Reapply that narrow annotation after codegen if necessary.

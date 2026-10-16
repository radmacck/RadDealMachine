---
name: OpenAPI document metadata size limit
description: Avoid expanding transaction-document schemas inside the generated command-center response.
---

Deeply extending transaction-document metadata in the shared OpenAPI component can expand the inferred `GetCommandCenterResponse` type beyond TypeScript's serialization limit (`TS7056`) during code generation/typecheck.

**Why:** The broad aggregate response composes many nested schemas, so a local-looking document metadata field can push its generated type over the compiler limit.

**How to apply:** Keep rich contract-package details in the immutable document/PDF or expose them through a focused endpoint with a small response type; rerun OpenAPI codegen and library typechecks after contract changes.

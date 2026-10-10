# AI Integration Design

English | [简体中文](ai-integration.zh.md)

This repository receives AI output through a restricted JSON protocol and does not use endpoint-native tool calling.

**The reason: AI only produces candidate data — parsing, validation, and execution are all controlled by the server.**

This keeps protocol parsing, safety checks, and error handling inside our own code: easy to test, and less dependent on any particular provider's implementation.

## Design conventions

- **Output protocol:** the AI returns JSON matching a given schema; the server parses and validates it. Only validated output enters the proposal flow.
- **Security boundary:** the AI never touches the database, the file system, or a shell. The prompt is not a security boundary — actual permissions are enforced by the server.
- **Unified transport:** `infrastructure/ai/` handles SDK, timeouts, error mapping, and retries, with no business logic. Prompts and per-domain parsing clients live in their own domains.
- **Unified entries:** `json()` for structured data, `text()` for prose.
- **Failure handling:** one retry on parse failure; if it still fails, tell the user plainly — no guessing, no silent drops.
- **Testing rule:** automated tests never hit a real model; real-model regression runs separately.

This design prioritizes controllability and testability over squeezing out the model's full capability.

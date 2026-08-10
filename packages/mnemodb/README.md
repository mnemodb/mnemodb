# MnemoDB

**The agent memory format — a database whose files you can read.**

Plain-text, Markdown-compatible memory for AI agents: typed entries with
provenance, TTL, deterministic merges, and token-budget-aware loading —
in files you can read, diff, and version. Every CLAUDE.md/AGENTS.md is
already a valid (untyped) MnemoDB file.

- **Give your agent memory (MCP):** `claude mcp add mnemodb -- npx -y @mnemodb/mcp`
- **CLI:** `npx @mnemodb/cli init` then `list`, `doctor`, `compact`, `migrate` (bin: `mnemo`)
- **Library:** `npm i @mnemodb/core` (this package re-exports it)
- **Spec:** bundled as SPEC.md; source at https://github.com/mnemodb/mnemodb

License: Apache-2.0 (code), CC BY 4.0 (spec).

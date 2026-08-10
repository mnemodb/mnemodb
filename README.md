# MnemoDB

[![CI](https://github.com/mnemodb/mnemodb/actions/workflows/ci.yml/badge.svg)](https://github.com/mnemodb/mnemodb/actions/workflows/ci.yml)

**The agent memory format — a database whose files you can read.**

MnemoDB is a plain-text, Markdown-compatible file format (`.mem.md`) for the
persistent memory of AI agents, plus the tooling around it:

- [`spec/SPEC-v0.1.md`](spec/SPEC-v0.1.md) — the format specification (CC BY 4.0)
- [`packages/core`](packages/core) — `@mnemodb/core`: parse, serialize, index,
  resolve, lifecycle, merge, validate (TypeScript, zero runtime deps, Apache-2.0)
- [`packages/cli`](packages/cli) — the `mnemo` CLI: init, list, show, doctor, compact, migrate
- [`packages/mcp`](packages/mcp) — `@mnemodb/mcp`: the memory engine as an MCP server (memory_recall, memory_remember, memory_review, memory_compact, memory_boot) for Claude Code, Cursor, and any MCP client
- [`fixtures/`](fixtures) — conformance corpus; `dogfood/` is MnemoDB's own
  real memory store, maintained in MnemoDB format since day one

Every MnemoDB file is valid Markdown; every existing Markdown memory file
(CLAUDE.md, AGENTS.md) is already a valid untyped MnemoDB file.

Status: spec v0.1 (draft, post-Phase-0), implementation v0.1 in progress.

**[How to use it →](docs/USAGE.md)** · See [CHANGELOG.md](CHANGELOG.md) for release history.

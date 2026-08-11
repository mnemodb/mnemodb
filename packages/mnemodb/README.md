# MnemoDB

**A structured, portable, auditable memory format for AI agents — a database whose files you can read.**

```
claude mcp add mnemodb -- npx -y @mnemodb/mcp
```

Repo, spec, and security audit: https://github.com/mnemodb/mnemodb

---

## What it is

A plain-text, Markdown-compatible file format (`.mem.md`) for the persistent
memory of AI agents, plus the engine and tooling around it. A memory is a
Markdown heading with a one-line metadata span:

```markdown
## decision: We use PostgreSQL LISTEN/NOTIFY for cache invalidation, not Redis
`mnemo c4d1 | src: user | conf: high | supersedes: 99e0`

Redis was dropped to cut infra count. Revisit if we exceed ~500 notifications/s.
```

It renders in any Markdown viewer, diffs cleanly in git, and a program reads
every field unambiguously. Every existing `CLAUDE.md` / `AGENTS.md` is already a
valid (untyped) MnemoDB file — adoption requires renaming and migrating nothing.

## Why — vs the memory you may already have

AI agents already have some memory: `CLAUDE.md` loads a flat file into context,
and Claude's [memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
gives the model a folder to organize however it likes. Both work. **MnemoDB
isn't a replacement — it's the structure and discipline they don't provide.**

"Give the model a folder and trust it" is simple and often good enough. MnemoDB
is the opposite bet — a *defined format* with real guarantees:

- **Lifecycle, not sprawl** — typed entries with TTLs, supersession, and a
  `compact` pass that archives what's expired or replaced. A flat memory file
  only grows and rots; MnemoDB forgets on purpose, auditably.
- **Provenance & trust** — every memory records its source (`user` / `agent` /
  `tool`). Tool-sourced content is flagged `untrusted` and can never supersede a
  human instruction, so a poisoned memory can't hijack future sessions.
- **Portable** — the same files work across Claude Code, Cursor, and any MCP
  client. Not locked to one vendor.
- **Auditable** — readable Markdown in your git repo; `git diff` shows exactly
  what your agent learned, and `mnemo doctor` lints for staleness, contradictions,
  and damage.

**Worth it when** you want the agent to maintain memory itself across many
sessions without decay, you work across more than one AI tool, or you need to
audit and trust what's in memory. **Overkill when** a short hand-curated
`CLAUDE.md` already does the job — we'd rather say so up front.

## How to use it

```bash
npx @mnemodb/cli init                      # create a store (or migrate CLAUDE.md)
claude mcp add mnemodb -- npx -y @mnemodb/mcp   # give your agent the tools
npx @mnemodb/cli list                      # inspect anytime — it's just files
```

Then add a short instruction to `CLAUDE.md` so the agent actually calls the
tools. Full walkthrough: https://github.com/mnemodb/mnemodb/blob/main/docs/USAGE.md

## Packages

- `mnemodb` (this package) — umbrella; re-exports `@mnemodb/core` and bundles the spec
- `@mnemodb/core` — parse, serialize, index, resolve, lifecycle, merge, validate (zero deps)
- `@mnemodb/cli` — the `mnemo` command line
- `@mnemodb/mcp` — the memory engine as an MCP server for Claude Code, Cursor, any MCP client

## Status

**v0.1 — early. Honest feedback wanted, not stars.** Security-hardened by an
adversarial audit; 46 tests enforced as a ship gate on every release.

License: Apache-2.0 (code), CC BY 4.0 (spec).

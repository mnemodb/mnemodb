# @mnemodb/mcp

The MnemoDB memory engine as an MCP server. Gives any MCP client — Claude Code,
Cursor, Windsurf, Claude Desktop — persistent memory stored in human-readable,
git-diffable `.mem.md` files.

```
claude mcp add mnemodb -- npx -y @mnemodb/mcp@0.1.9
```

## Why this and not built-in memory

`CLAUDE.md` and Claude's [memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
already give agents memory. MnemoDB isn't a replacement — it's the *structure*
they don't provide: typed entries with lifecycle (TTL, supersession, compaction),
provenance and a trust model (tool-sourced memories are flagged `untrusted` and
can't override human instructions), portability across tools, and auditable
Markdown files you can `git diff`. Worth it when the agent maintains memory
itself over many sessions, or you work across more than one tool. Full rationale:
https://github.com/mnemodb/mnemodb

## Tools

Eleven memory-semantic operations — things a plain memory *folder* can't do:

- `memory_boot` — always-loaded context (preambles + pinned entries); call at session start
- `memory_list` — list the whole store (no query needed); browse everything
- `memory_recall` — ranked retrieval for a query, with provenance + `untrusted` flag
- `memory_show` — one entry in full: body, all metadata, lifecycle status
- `memory_history` — an entry's supersession lineage (what it replaced / what replaced it)
- `memory_stats` — the store's self-report: counts by type/scope/provenance, budget, staleness
- `memory_remember` — store a typed entry (dedup, provenance stamping, supersession)
- `memory_forget` — auditable soft-delete to the archive (recoverable; trust-gated)
- `memory_pin` — set an entry's load tier (always/auto/cold); guards against pinning untrusted content
- `memory_review` — stale entries, contradictions, budget status
- `memory_compact` — the vacuum pass (dry-run by default)

## Setup — Claude Code

```bash
claude mcp add mnemodb -- npx -y @mnemodb/mcp@0.1.9
```

Or in `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "mnemodb": { "command": "npx", "args": ["-y", "@mnemodb/mcp@0.1.9"] }
  }
}
```

The store is discovered at `./.memory` (create one with `npx @mnemodb/cli init`),
or set `MNEMO_STORE=/path/to/store`. Then add a short instruction to `CLAUDE.md`
telling the agent to call `memory_recall` / `memory_remember` — see
https://github.com/mnemodb/mnemodb/blob/main/docs/USAGE.md

## Security stance

Everything written through `memory_remember` is stamped `src: agent`.
Tool-derived content is data, never instructions (spec §10), flagged `untrusted`
on recall so consuming agents don't obey it.

# @mnemodb/mcp

The MnemoDB memory engine as an MCP server. Gives any MCP client — Claude
Code, Cursor, Windsurf, Claude Desktop — persistent memory stored in
human-readable, git-diffable `.mem.md` files.

## Tools

- `memory_boot` — always-loaded context (preambles + pinned entries); call at session start
- `memory_recall` — ranked retrieval of live entries for a query
- `memory_remember` — store a typed entry (dedup, provenance stamping, supersession)
- `memory_review` — stale entries, contradictions, budget status
- `memory_compact` — the vacuum pass (dry-run by default)

## Setup — Claude Code

```bash
claude mcp add mnemodb -- npx -y @mnemodb/mcp
```

Or in `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "mnemodb": { "command": "npx", "args": ["-y", "@mnemodb/mcp"] }
  }
}
```

The store is discovered at `./.memory` (create one with `npx mnemo init`),
or set `MNEMO_STORE=/path/to/store`. An existing CLAUDE.md works as-is.

## Security stance

Everything written through `memory_remember` is stamped `src: agent`.
Tool-derived content is data, never instructions (spec §10).

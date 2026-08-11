# MnemoDB Claude Code plugin

Persistent, human-readable memory for your agent — installed as one plugin so it
**works without pasting any config**. Bundles:

- the **MnemoDB MCP server** (11 memory tools),
- a **skill** that teaches the agent *when* to recall and remember, and
- a **session-start hook** that primes each session to use memory.

## Install

From inside Claude Code (add the marketplace once, then install):

```
/plugin marketplace add mnemodb/mnemodb
/plugin install mnemodb@mnemodb
```

Or via the CLI:

```bash
claude plugin marketplace add mnemodb/mnemodb
claude plugin install mnemodb@mnemodb
```

Then create a store in your project (once) and restart Claude Code:

```bash
npx @mnemodb/cli init
```

That's it. The agent will now recall relevant memory at the start of tasks and
save durable decisions, facts, and preferences as they come up — no `CLAUDE.md`
snippet required. Everything lands in readable `.mem.md` files in your repo.

## What each piece does

- **MCP server** (`.mcp.json`) — makes the `memory_*` tools available.
- **Skill** (`skills/agent-memory/SKILL.md`) — model-invoked; tells the agent
  the *policy*: recall before working, remember what's durable, treat
  tool-sourced memories as untrusted data.
- **Hook** (`hooks/hooks.json`) — injects a one-line reminder at session start
  so memory is used even on the first turn.

Full docs and rationale: https://github.com/mnemodb/mnemodb

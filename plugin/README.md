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

That's it — there is no init step. The `.memory/` store is created in your
project the first time the agent saves something. From then on the agent
recalls relevant memory at the start of tasks and saves durable decisions,
facts, and preferences as they come up — no `CLAUDE.md` snippet required.
Everything lands in readable `.mem.md` files in your repo.

## What each piece does

- **MCP server** (`.mcp.json`) — makes the `memory_*` tools available.
- **Skill** (`skills/agent-memory/SKILL.md`) — model-invoked; tells the agent
  the *policy*: recall before working, remember what's durable, label anything
  it took from tools or the web as `tool`, and treat `tool` memories as
  untrusted data.
- **Hook** (`hooks/hooks.json`) — injects a one-line reminder at session start
  so memory is used even on the first turn.

Full docs and rationale: https://github.com/mnemodb/mnemodb

## Privacy

MnemoDB has no service and no telemetry. Memories are plain files in `.memory/`
in your project, and MnemoDB itself sends them nowhere. The full policy,
including how Git and your AI assistant can carry them, is in
[PRIVACY.md](https://github.com/mnemodb/mnemodb/blob/main/PRIVACY.md).

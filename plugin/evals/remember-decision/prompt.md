---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill, mcp__plugin_mnemodb_mnemodb__memory_remember, mcp__plugin_mnemodb_mnemodb__memory_recall, mcp__plugin_mnemodb_mnemodb__memory_list, mcp__plugin_mnemodb_mnemodb__memory_boot]
---

We talked it through and we're going with Postgres LISTEN/NOTIFY for cache invalidation instead of Redis, mainly to cut one piece of infrastructure. Let's move on to the schema.

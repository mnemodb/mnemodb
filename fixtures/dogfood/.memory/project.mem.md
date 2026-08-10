---
mnemo: "0.1"
scope: project
title: "MnemoDB — agent memory (dogfood store)"
updated: 2026-08-10T10:30:00Z
budget: 2500
---

MnemoDB is a spec-first project: a Markdown-compatible memory format for AI
agents. Repo will live at github.com/mnemodb. Do not publish implementation
code before the spec survives Phase 0 hand-validation.

## decision: The project is named MnemoDB, not AMF
`mnemo n4m1 | src: user/2026-08-10 | supersedes: a0f1 | pin: always`

AMF collided three ways: Adobe Action Message Format, npm `amf` (taken 2013),
and an active AMF Bowling trademark. "mnemodb" was free on npm and GitHub at
check time. Files use `.mem.md`; sigil is `mnemo`.

## decision: TypeScript first; Rust core deferred to v0.3
`mnemo t5l4 | src: user/2026-08-10 | conf: high`

One language covers library + CLI + MCP server; npm-centric ecosystem;
schema/merge rules become compiler-checked types. Python-first was rejected
because first target users are coding-agent users, not framework users.

## decision: First integration target is Claude Code
`mnemo c1cd | src: user/2026-08-10 | conf: high`

Deepest plugin surface (MCP + skill + hooks) and daily dogfooding. Cursor and
Windsurf follow via the same MCP server.

## decision: Borrow database operations vocabulary, avoid relational vocabulary
`mnemo v0cb | src: user/2026-08-10`

Store, index, query, compaction/vacuum, migration, merge — yes. Tables, rows,
columns, "SQL" — no. Identity: a database whose files you can read.

## fact: npm package mnemodb@0.0.1 published 2026-08-10 by zivuch
`mnemo p0b1 | src: user/2026-08-10 | conf: high`

Claims the unscoped name. GitHub org `mnemodb` and npm org/scope `@mnemodb`
also created 2026-08-10. Stub bundles SPEC.md.

## fact: engramdb stores memories in an opaque SQLite db with local embeddings
`mnemo e9db | src: tool/2026-08-10 | review: 2026-11-01`

npm engramdb 0.2.2 (03/2026): better-sqlite3 + sqlite-vec, nomic-embed-text
768-dim embeddings, weighted recall (similarity 60/importance 25/recency 15).
Default store `~/.global-agent-memory.db` — not git-diffable, not mergeable.

## fact: memvault stores memories in user-hosted Postgres via Prisma
`mnemo m9vt | src: tool/2026-08-10 | review: 2026-11-01`

npm memvault (04/2026): tenant isolation, TTL support, MIT, self-hosted,
drop-in tools for Anthropic/OpenAI/Vercel SDKs. Requires a running database.

## insight: Every surveyed competitor is engine-first with opaque storage
`mnemo g4p1 | src: agent/2026-08-10 | conf: high | pin: always`

engramdb (SQLite), memvault (Postgres), thebtf/engram (Postgres+pgvector+gRPC
daemon). None offers a portable, human-readable, git-mergeable file format.
That gap is MnemoDB's entire positioning; defend it in every public artifact.

## todo: Decide licenses (Apache-2.0 code / CC BY 4.0 spec proposed)
`mnemo l1cx | src: agent/2026-08-10 | ttl: 90d`

## todo: Decide repo strategy (monorepo recommended) before Phase 1
`mnemo r3po | src: agent/2026-08-10 | ttl: 90d`

## decision: Licenses are Apache-2.0 for code, CC BY 4.0 for the spec
`mnemo lcns | src: user/2026-08-10 | supersedes: l1cx | conf: high`

Chosen for the standards play: Apache's patent grant reassures corporate
adopters; CC BY keeps attribution on the spec. MIT considered, minor loss.

## decision: One monorepo (mnemodb/mnemodb) holds spec, packages, and fixtures
`mnemo mono | src: user/2026-08-10 | supersedes: r3po | conf: high`

Single issue tracker; spec+code change in one PR while the format moves.
Reversible: split later is easy, merge later is painful.

## fact: Phase 1 shipped: repo live at github.com/mnemodb/mnemodb with CI green on first run
`mnemo taodjk3r | src: agent | updated: 2026-08-10 | tags: milestone`

## fact: Phase 2 engine built: @mnemodb/mcp exposes recall/remember/review/compact/boot over stdio MCP
`mnemo qnitz2t9 | src: agent | updated: 2026-08-10 | tags: milestone`

## insight: Recall uses light stemming; the es-suffix rule broke license/licenses matching and was removed
`mnemo tybs1yev | src: agent | updated: 2026-08-10 | tags: retrieval`

## insight: Run the test suite on a second OS before publishing — first Windows run exposed three portability bugs in one day
`mnemo yv76come | src: agent | updated: 2026-08-10 | tags: portability, process`

## insight: Windows checkouts use CRLF: parsers must strip trailing CR before regex anchors, and tests must use fileURLToPath, never URL.pathname
`mnemo 4jhtijfm | src: agent | updated: 2026-08-10 | tags: portability, parser`

## fact: Full end-to-end audit of 0.1.0 found two HIGH bugs: fence-blind entry splitting and concurrent-writer lost updates — both fixed in 0.1.1
`mnemo vwpfpsx0 | src: agent | updated: 2026-08-10 | tags: audit, milestone`

## insight: Writers must be serialized: atomic rename alone cannot protect read-modify-write; the store lock (mkdir-based) is mandatory for every write path
`mnemo gddmi088 | src: agent | updated: 2026-08-10 | tags: concurrency`

## fact: Security+i18n review found two more HIGH bugs: non-ASCII unsearchable, and recall stripped provenance (defeating the injection defense) — both fixed in 0.1.1
`mnemo t8b76827 | src: agent | updated: 2026-08-10 | tags: audit, security`

## insight: recall MUST expose src and an untrusted flag; the injection defense is only real if provenance reaches the consuming agent
`mnemo l66g9ts5 | src: agent | updated: 2026-08-10 | tags: security`

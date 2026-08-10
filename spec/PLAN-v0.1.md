# MnemoDB v0.1 — Build Plan (Planning Only, No Implementation)

**Scope of this plan:** the full memory *system*, not just the file format. Four layers: format spec → core library → memory engine → integrations. The plan takes v0.1 from "draft spec" to "a stranger can install it, use it with their coding agent for a week, and feel the difference."

> Renamed from the earlier working title "AMF" (2026-08-10) after the collision check (Adobe Action Message Format, npm `amf`, AMF Bowling trademark). Project: **MnemoDB**. Format files: `.mem.md`.

---

## 1. Product definition for v0.1

**One sentence:** a drop-in memory system for coding agents that stores everything in portable, human-auditable MnemoDB files — a database whose files you can read — installed in under a minute, requiring zero migration of existing CLAUDE.md/AGENTS.md files.

**The v0.1 user:** a developer already using a coding agent (Claude Code, Cursor, etc.) whose memory file has grown messy, stale, or contradictory.

**The v0.1 promise (success criteria — all four must hold):**

1. Install → working memory in < 1 minute, with an existing CLAUDE.md/AGENTS.md picked up as-is.
2. The agent demonstrably recalls a fact learned three sessions ago without the user re-explaining it.
3. After 2+ weeks of use, compaction keeps the always-loaded context under the token budget while the store keeps growing.
4. A `git merge` of two divergent memory branches resolves cleanly via the merge rules.

**Explicitly out of scope for v0.1** (deferred, not rejected): embeddings/vector retrieval, knowledge-graph memory, hosted sync service, multi-user team stores, cryptographic signing, Rust core, non-coding-agent use cases (chatbots, RAG pipelines).

**Competitive landscape (checked 2026-08-10):** `engramdb` (npm, active since ~03/2026 — "persistent, semantically-searchable memory for AI coding agents," MCP server) and `memvault` (npm, ~04/2026 — tenant-isolated agent memory, Prisma-backed) are live projects in the same space. Both appear engine-first with opaque storage; neither is format-first or human-readable-first. That is MnemoDB's differentiation — and evidence the window is open but closing. **Phase 0 includes a structured review of both.**

## 2. Architecture (what gets built, per layer)

### Layer 0 — Spec (exists, will be revised)
The v0.1 draft spec is input to this plan, not a finished artifact. Phase 1 dogfooding is expected to force revisions → spec v0.2 ships at the end of this plan, informed by real use. The five Appendix D questions get answered by evidence, not debate.

**Positioning (decided):** MnemoDB is infrastructure, not content — the SQLite of agent memory. Skill collections (e.g. mattpocock/skills, ~210k stars) and agent frameworks are target *users* of the format, never competitors: their existing ad-hoc conventions (CONTEXT.md vocabulary, learning-records, handoff docs) map onto MnemoDB entry types (spec Appendix C). Terminology borrows database *operations* vocabulary (store, index, query, compaction/vacuum, migration, merge) and avoids database *structure* vocabulary (tables, rows, columns) — see the spec's terminology note.

### Layer 1 — Core library: `@mnemodb/core`
Single implementation for v0.1. **Language: TypeScript (decided 2026-08-10)** — the coding-agent ecosystem (MCP servers, Claude Code, Cursor extensions) is npm-centric, so one language covers library + CLI + MCP server, and the entry schema/merge rules become compiler-checked types; the Rust core with bindings stays on the roadmap for v0.3 when the format has stabilized.

Modules: `parse` (Markdown → entries + preamble, error-tolerant), `serialize` (round-trip byte-stable on untouched blocks — critical for clean git diffs), `index` (headings + metadata extraction, load-tier filtering), `resolve` (scope/supersession/recency rules), `merge` (the CRDT rules), `lifecycle` (TTL/review/expiry evaluation), `migrate` (prose → typed entries, reversible; plus importers for the wild conventions in spec Appendix C — CONTEXT.md, learning-records, handoff docs, ADRs — a strong "it eats what already exists" demo), `validate` (lint + conformance).

### Layer 2 — CLI: `mnemo`
Thin shell over the library, for humans and CI: `init`, `add`, `list/query`, `show`, `compact` (dry-run by default), `merge` (+ a git merge-driver mode), `migrate`, `doctor` (lint: budget overruns, stale entries, contradiction candidates, orphan supersedes).

### Layer 3 — Memory engine: `@mnemodb/mcp` (an MCP server)
The brain, shipped in the one form every major agent can already plug in. Exposes tools: `memory_recall(query, scope?)` — index-first retrieval (BM25/keyword in v0.1; embeddings deferred); `memory_remember(statement, type, metadata?)` — enforces write policy: dedup check against existing entries, provenance stamping, supersession suggestion when contradicting an existing entry; `memory_review()` — surfaces stale/contradictory entries for resolution; `memory_compact()` — runs the lifecycle pass, returns an auditable diff, never auto-commits.

Write policy in v0.1 is deliberately simple: the *agent* decides what's memorable (guided by a prompt template we ship); the engine enforces hygiene (dedup, provenance, format). Smart automatic memory extraction is a v0.2+ research problem — do not block v0.1 on it.

### Layer 4 — Integrations
**Claude Code first (decided 2026-08-10)** — plugin: MCP server + a skill teaching when to remember/recall + session-start hook loading the `pin: always` tier. Cursor/Windsurf via the same MCP server with setup docs. Everything else via a generic "any MCP client" guide.

## 3. Phases

**Phase 0 — Validate by hand (1–2 weeks).** Before writing any code: (a) reserve the name — npm `mnemodb` (confirmed free 2026-08-10), the `@mnemodb` npm org, and the GitHub org — names decay fast; (b) structured review of `engramdb` and `memvault` (what they store, how, what users complain about); (c) use the format manually in 2–3 real projects: hand-maintain MnemoDB files, simulate compaction and merges in an ordinary agent session. Goal: catch format mistakes while changes are free. Gate to Phase 1: the format survives two weeks of real use with no more than minor revisions. If it needs surgery, revise the spec and repeat — cheapest possible iteration loop.

**Phase 1 — `@mnemodb/core` + CLI (3–4 weeks).** Parser/serializer first with round-trip stability as the north-star test; then index/resolve; then merge; then lifecycle/migrate; CLI grows alongside. Deliverable: `npx mnemo doctor` works on a real store.

**Phase 2 — `@mnemodb/mcp` + Claude Code integration (2–3 weeks).** Recall and remember first, review/compact second. Deliverable: the four success criteria pass in your own daily work.

**Phase 3 — Dogfood and harden (2 weeks, overlapping).** Run it on every project you touch. Every annoyance becomes an issue; every issue becomes a spec revision, a lint rule, or a prompt-template fix. Output: spec v0.2, answering the Appendix D questions from evidence.

**Phase 4 — Publish.** Monorepo (spec + packages + conformance fixtures), README with a 60-second demo GIF, npm packages, a "why" essay (the PDF-vs-memory reasoning from this conversation is the seed), then Show HN / r/LocalLLaMA / agent-framework communities. Distribution follows the dual-channel playbook validated by mattpocock/skills: a managed Claude Code plugin in the official marketplace (subscribe, auto-update) *and* a one-line `npx` installer for the hackable path. Goal of publishing v0.1: feedback and first outside contributors, not adoption numbers. Post-v0.1 outreach: pitch MnemoDB as the storage layer to the authors of popular skill repos and memory frameworks — one native integration (e.g. a handoff skill writing MnemoDB episodes) is worth more than any launch post.

Total: roughly 8–11 weeks part-time to published v0.1.

## 4. Testing strategy

- **Conformance fixtures:** a `fixtures/` corpus of MnemoDB files (valid, edge-case, malformed, legacy-prose) with expected parse output as JSON — this doubles as the seed of the future multi-implementation conformance suite.
- **Round-trip property tests:** parse → serialize is byte-identical for untouched content; randomized entry mutations never corrupt neighboring blocks.
- **Merge property tests:** commutativity, associativity, idempotence of the merge on generated stores (the CRDT claims must be *tested*, not asserted).
- **Engine evals:** a small scripted benchmark — seed a store, run N simulated sessions, assert recall of planted facts and budget compliance after compaction. Crude in v0.1, but it makes "does memory work?" measurable.

## 5. Risks and mitigations

- **Platform steamroll** (vendors ship native memory): mitigation is speed + interop positioning — MnemoDB as the portable layer *under* vendor engines, not a competitor to them. Ship before the window closes.
- **Convention fragmentation** (the sharper near-term risk, confirmed by field evidence): popular repos are already inventing bespoke memory-file conventions — mattpocock/skills alone carries three (CONTEXT.md, learning-records with supersession, handoff docs) — and engine-first products (engramdb, memvault) are shipping opaque stores now. If a few more mega-repos or engines entrench their own formats, the "standard substrate" slot closes. Mitigation: the Appendix C importers make adopting MnemoDB cheaper than maintaining a bespoke convention, and outreach targets exactly those authors first.
- **Format churn after code exists:** mitigated by Phase 0 hand-validation and by keeping v0.x explicitly unstable (breaking changes allowed until v1.0).
- **Write-policy quality** (agent remembers junk or misses gold): contained in prompt templates + `doctor`/`review` so bad memories are visible and cheap to fix; full solution deferred to v0.2 evals.
- **Scope creep toward "full memory platform":** the out-of-scope list in §1 is the contract. Anything not needed to make the four success criteria pass waits.

## 6. Decisions

**Decided (2026-08-10):** name — MnemoDB (npm `mnemodb`, `@mnemodb` scope, and GitHub org all claimed same day); language — TypeScript first, Rust core deferred to v0.3; first integration target — Claude Code; terminology — database operations vocabulary adopted, relational structure vocabulary avoided; licenses — Apache-2.0 for code, CC BY 4.0 for the spec; repo strategy — one monorepo (`mnemodb/mnemodb`) holding spec, packages, and fixtures.

**Still open:** metadata syntax final call (inline code vs HTML comment) — Phase 0 evidence leans strongly to inline code; confirm during Phase 1 dogfooding and close in spec v0.2.

**Phase 0 status: complete (2026-08-10) — gate passed.** See PHASE0-REPORT.md. Phase 1 is unblocked.

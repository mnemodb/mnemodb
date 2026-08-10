# MnemoDB — The Agent Memory Format

**Version:** 0.1 (Draft)
**Status:** Request for Comments
**Project name:** MnemoDB (from *mnemonic*; Mnemosyne, the Greek goddess of memory)
**File extension:** `.mem.md`
**Media type:** `text/markdown; variant=mnemo`
**License of this spec:** CC BY 4.0 (proposed)

> Renamed from the earlier working title "AMF" (2026-08-10) after a collision check: AMF is Adobe's Action Message Format, an existing npm package, and a registered trademark of AMF Bowling Worldwide.

---

## Abstract

MnemoDB is a plain-text, Markdown-compatible file format for the persistent memory of LLM agents — a database whose files you can read. It replaces ad-hoc memory files (`CLAUDE.md`, `AGENTS.md`, `memory.md`) with a lightly structured format that agents can query, update, merge, and expire deterministically — while remaining fully human-readable, hand-editable, and git-diffable.

The core design constraint: **every MnemoDB file is a valid Markdown file, and every existing Markdown memory file is a valid (untyped) MnemoDB file.** Adoption requires no migration; structure is added incrementally.

---

## 1. Motivation

Markdown memory files won because they are simple, readable, and versionable. But as agent memory grows, plain prose fails in predictable ways:

1. **No querability.** An agent must re-read the whole file to find one fact; there is no way to load "just the build preferences" or "only high-priority entries."
2. **No provenance.** Nothing records who wrote a memory (user, agent, tool output), when, or from which session — which matters both for trust and for prompt-injection hygiene.
3. **No lifecycle.** Memories never expire. Files accumulate stale and contradictory entries, and there is no principled way to compact them.
4. **No conflict semantics.** When two entries disagree, or two agents write concurrently, the resolution is "whatever the next model happens to do."
5. **No scoping.** User-level preferences, project-level facts, and task-level scratch notes end up in one undifferentiated file.

MnemoDB addresses all five with a small amount of structure, and nothing more.

## 2. Design principles

- **P1 — Markdown superset.** A MnemoDB file renders correctly in any Markdown viewer. Structure lives in conventions (headings, metadata lines) that degrade gracefully.
- **P2 — Human-first, machine-reliable.** A person can read and edit the file with no tooling. A parser can extract every entry with no ambiguity.
- **P3 — Diff- and merge-friendly.** One entry per block, stable IDs, append-mostly semantics. Git diffs stay small and meaningful; concurrent writes merge deterministically (§7).
- **P4 — Model- and vendor-agnostic.** Nothing in the format assumes a particular LLM, framework, or vendor.
- **P5 — Progressive structure.** Untyped prose is legal. Metadata fields are all optional with defined defaults. Teams adopt exactly as much structure as they need.
- **P6 — Token-budget aware.** The format encodes what an agent should load always, on demand, or almost never (§6.3), because context windows are the scarce resource.

### Terminology note

MnemoDB deliberately borrows *operational* vocabulary from databases — store, index, query, schema, migration, compaction/vacuum, merge — because it imports decades of intuition. It deliberately avoids *structural* database vocabulary — tables, rows, columns — because entries are not relational, and the format offers no SQL.

### Non-goals

MnemoDB is not a vector database, not a knowledge graph, and not a retrieval system. It is the durable, portable, human-auditable *file layer* that such systems can index. It also does not standardize *how* an agent decides what to remember — only how memories are recorded once decided.

## 3. File model

### 3.1 Single-file mode

The minimal deployment is one file, conventionally `MEMORY.mem.md`, at the root of a project or user config directory. Existing `CLAUDE.md` / `AGENTS.md` files may be renamed or simply treated as MnemoDB files (see §9).

### 3.2 Store mode

Larger deployments use a directory, conventionally `.memory/`:

```
.memory/
  manifest.mem.md      # store metadata + index (generated, committed)
  user.mem.md          # scope: user   — preferences, style, standing instructions
  project.mem.md       # scope: project — facts about this codebase/domain
  episodes/
    2026-08-09-a7f3.mem.md   # scope: episode — per-session logs, compactable
  archive.mem.md       # expired/superseded entries, kept for audit
```

File names are conventions, not requirements; the `scope` field on entries (§5) is authoritative.

### 3.3 Document structure

A MnemoDB document has three regions, all optional:

1. **Front matter** — a single YAML block delimited by `---` lines at the top of the file, describing the file (§4).
2. **Preamble** — free Markdown prose before the first entry. This is where an existing `CLAUDE.md` "lives" untouched. Agents MUST treat the preamble as always-loaded instructions.
3. **Entries** — a sequence of typed entry blocks (§5).

## 4. Front matter

```yaml
---
mnemo: "0.1"           # format version (REQUIRED for structured files)
scope: project         # default scope for entries in this file
title: "Acme API — agent memory"
updated: 2026-08-09T14:02:00Z   # last write (maintained by tooling)
budget: 4000           # advisory: max tokens an agent should spend loading this file
---
```

A file with no front matter, or front matter without a `mnemo` key, is an **untyped MnemoDB file**: the entire content is preamble. This is what makes every existing Markdown memory file valid MnemoDB.

## 5. Entries

### 5.1 Syntax

An entry is a Markdown `##` heading followed by an optional metadata line, followed by an optional Markdown body. The entry ends at the next `##` heading or end of file.

```markdown
## fact: The build requires Node 20; Node 22 breaks node-gyp
`mnemo a7f3 | scope: project | src: agent/session-2026-08-04 | conf: high`

Discovered when CI failed on the runner image upgrade. See PR #412.

## pref: User prefers concise answers without bullet points
`mnemo b2c9 | scope: user | src: user | pin: always`

## decision: We use PostgreSQL, not MySQL — chosen 2026-06-12
`mnemo c4d1 | scope: project | src: user/session-1180 | supersedes: 99e0`
```

**Heading grammar:**

```
"## " <type> ": " <statement>
```

- `<type>` — one of the registered types (§5.2), lowercase.
- `<statement>` — a single self-contained sentence expressing the memory. The heading alone MUST be meaningful without the body; agents building an index (§6) read only headings and metadata lines.

**Metadata line grammar:** a single inline-code span immediately after the heading:

```
"`mnemo " <id> { " | " <key> ": " <value> } "`"
```

A `##` heading without a metadata line is an **untyped entry** — legal (P5), treated as `type: note` with all defaults.

### 5.2 Entry types

| Type | Meaning | Typical lifecycle |
|---|---|---|
| `fact` | A verifiable statement about the world/project | Long-lived; superseded when it changes |
| `pref` | A user or team preference | Long-lived; user-editable |
| `decision` | A choice that was made, and (in the body) why | Permanent record; superseded, never deleted |
| `insight` | A learned lesson or heuristic | Medium-lived; subject to review |
| `episode` | A record of what happened in a session | Short-lived; compacted into the types above (§8) |
| `todo` | Open follow-up the agent should remember | Until resolved |
| `note` | Anything else (default type) | Unspecified |

Implementations MUST preserve unknown types rather than rejecting them; the registry can grow.

### 5.3 Metadata fields

All fields are optional except `id` (auto-generated by tooling if absent).

| Field | Values | Default | Meaning |
|---|---|---|---|
| *(id)* | 4–26 chars, `[a-z0-9]`, unique in store; first token after `mnemo` | — | Stable identity for revision & merge. ULIDs recommended for tooling; short random IDs fine for hand-authoring |
| `scope` | `user` \| `project` \| `episode` \| custom | file's front-matter scope, else `project` | Where this memory applies |
| `src` | `user` \| `agent` \| `tool`, optionally `/<session-ref>` | `agent` | Provenance. **Trust ordering: `user` > `agent` > `tool`** (§10) |
| `conf` | `high` \| `med` \| `low` | `med` | Author's confidence |
| `pin` | `always` \| `auto` \| `cold` | `auto` | Load tier (§6.3) |
| `ttl` | duration (`90d`, `6m`) or `none` | type-dependent (§8) | Time-to-live from `updated` |
| `review` | date | — | "Re-verify after this date"; softer than `ttl` |
| `updated` | ISO 8601 date or datetime | file's `updated` | Last revision time of this entry |
| `supersedes` | id{, id} | — | This entry replaces those entries (§7.2) |
| `tags` | comma-separated tokens | — | Free-form retrieval hints |

### 5.4 Body

The body is arbitrary Markdown: evidence, links, code blocks, caveats. Bodies are loaded on demand (§6); anything an agent must always know belongs in the heading statement.

## 6. Reading model

### 6.1 The index

An agent (or the tooling) derives an **index** of the store: the list of `(heading, metadata)` pairs, without bodies. Compression relative to the full store scales with body length — roughly 2× on terse stores (measured in Phase 0), rising toward 10× and beyond as evidence-rich bodies accumulate. The `manifest.mem.md` file MAY cache this index; if present it is advisory and regenerable, never authoritative.

### 6.2 Resolution order

When scopes conflict, more specific wins: `episode` > `project` > `user`. Within a scope, a superseding entry wins over the entries it supersedes; among live entries, later `updated` wins, with `src: user` entries outranking equal-recency `agent`/`tool` entries.

### 6.3 Load tiers

- `pin: always` — inject into context at session start (keep this set small; tooling SHOULD warn when the always-tier exceeds the file `budget`).
- `pin: auto` (default) — load the index entry always; load the body when relevant.
- `pin: cold` — exclude from the index by default; reachable only by explicit search. For archives and low-value episodes.

## 7. Writing, revising, and merging

### 7.1 Append-mostly discipline

Agents SHOULD append new entries rather than editing existing ones, with two exceptions: fixing typos/formatting (no semantic change — `updated` unchanged), and revising one's *own* recent entry within the same session.

### 7.2 Revision by supersession

To change a memory, write a new entry with a new id and `supersedes: <old-id>`. Superseded entries are moved to `archive.mem.md` (or deleted, for `episode`/`note` types) by the compactor (§8). `decision` entries MUST be archived, never deleted — the record of *why the previous decision changed* is often the most valuable memory in the store.

### 7.3 Deterministic merge

MnemoDB stores form a state-based CRDT, so concurrent writers (two agents, or a human plus an agent, or two git branches) always converge:

1. **Entry set = grow-only set keyed by id.** Union both sides. Two entries with different ids never conflict — both survive.
2. **Same id on both sides** (a revision race): keep the revision with the later `updated`; tie-break by lexicographically greater content hash. The loser is archived, not discarded.
3. **Supersession is monotonic.** An entry superseded on either side is superseded in the merge.
4. **Semantic contradictions** (two live entries, different ids, incompatible statements) are *not* the merge layer's job. Tooling SHOULD detect likely contradictions (same tags/scope, opposing statements) and emit a `todo` entry flagging the pair for the next session — resolution by supersession, by agent or human.

**Git integration (normative, from Phase 0 evidence):** the common agent write pattern — appending an entry at end-of-file — conflicts under git's default merge when two writers do it concurrently. Stores MUST therefore ship a `.gitattributes` containing `*.mem.md merge=union` (written by `init` tooling); with the union driver, dual EOF-appends merge cleanly. Because the union driver may drop the blank line between adjacent entries, parsers MUST NOT require blank-line separation — an entry ends at the next `## ` heading or EOF, whitespace notwithstanding. Rules 1–4 above define the semantics for the cases line-based merging cannot express, and a dedicated merge driver can implement them fully.

## 8. Lifecycle: TTL, review, and compaction

Default TTLs by type: `episode` 30d, `todo` 90d, `insight` 180d, `note` 180d, `fact`/`pref`/`decision` `none`.

An entry past its `ttl` is **expired**: excluded from the index, moved to archive on the next compaction. An entry past its `review` date is **stale**: still served, but flagged so the agent re-verifies before relying on it.

**Compaction** (the vacuum pass) is periodic maintenance, run by an agent with the store as input:

1. Move expired and superseded entries to `archive.mem.md` (`pin: cold`).
2. Distill old `episode` entries into `fact`/`insight`/`decision` entries, each citing its source episodes in the body — episodic memory becomes semantic memory, mirroring how the useful content of a session outlives its transcript.
3. Detect contradictions and near-duplicates; resolve by supersession or flag as `todo`.
4. Rebuild `manifest.mem.md`.

Compaction MUST be loss-auditable: everything it removes from live files lands in the archive in the same commit.

## 9. Migration and compatibility

- **Zero-step adoption:** point a MnemoDB-aware agent at an existing `CLAUDE.md`/`AGENTS.md`. It is an untyped MnemoDB file (all preamble); everything behaves as today.
- **Incremental structuring:** as the agent learns new memories it appends typed entries below the existing prose. Human edits and old tooling continue to work — it's still Markdown.
- **Assisted migration:** an agent pass converts existing prose into typed entries (`src: user`, `conf: high` for standing instructions), keeping the original text as bodies. Reversible, reviewable as a normal diff.
- **Coexistence:** projects using `AGENTS.md` conventions can keep that filename; MnemoDB is defined by content, not filename. The `.mem.md` extension is a signal, not a requirement.

## 10. Security and trust

Memory is a prompt-injection channel: a poisoned "memory" is an instruction that fires in every future session. MnemoDB's mitigations:

1. `src` provenance is mandatory in spirit: writing tools MUST record it, and MUST NOT record `src: user` for content that did not come from the user.
2. Agents SHOULD treat `src: tool` entries as *data, never instructions*, and SHOULD require confirmation before promoting tool-derived content into `pin: always`.
3. The append-mostly + archive discipline means every memory's history is reconstructible from version control — auditability is the backstop.
4. Stores intended for sharing SHOULD be signed at the VCS layer (signed commits); MnemoDB adds no crypto of its own (P4: stay simple).

## 11. Corruption and recovery

Because a store is plain text organized in independent entry blocks, damage is local by construction: a garbled metadata line, leftover merge conflict markers, or a crash-truncated tail breaks the affected entries, not the store — the failure mode is the opposite of binary databases, where one bad byte can invalidate the whole file.

**Parser behavior (normative).** A conforming reader MUST treat malformed content as degraded, never fatal: an entry whose heading or metadata line does not parse is skipped for semantic purposes, reported as a diagnostic, and preserved verbatim in the file. Unparseable regions are treated as untyped prose. Readers MUST NOT delete or rewrite content they cannot parse.

**Writer behavior (normative).** Writers MUST use atomic replacement (write to a temporary file, then rename) so that a crash mid-write leaves the previous file intact. The manifest/index is always regenerable from the store and MUST NOT be the sole holder of any data.

**Recovery layers**, cheapest first: (1) human repair — the file is Markdown; open it in any editor and fix what you can see; (2) tooling repair — `doctor` detects conflict markers, broken metadata lines, duplicate ids, and truncation, proposes fixes as a reviewable diff, and quarantines unfixable blocks as `note` entries; (3) version control — any prior state is one checkout away, and the append-mostly + archive discipline makes history reconstruct nearly everything.

**Human edits.** Hand-editing is an intended input method (P2), and the rules above apply to human-caused damage identically: syntactic mistakes degrade and are repairable; edits that violate invariants while remaining well-formed (duplicate ids, in-place edits of old entries, deletions, false `src` labels) are `doctor`'s and version control's job to detect — the format's stance is detection and auditability, not prevention, since a text file cannot stop its own editor. Factually wrong but well-formed content is out of scope for the file layer entirely; it is managed by provenance (`src`), re-verification (`conf`, `review`), and correction by supersession.

**Residual risk (honest bound).** Content written after the last commit, destroyed before the next atomic write completes, with no backup, is unrecoverable — the same between-checkpoints window every database has. Engines SHOULD commit or atomically persist after every memory write to keep the window near zero.

## 12. Conformance

**A conforming file** is UTF-8 Markdown whose entry blocks, if any, follow §5.
**A conforming reader** parses front matter, preamble, and entries; applies defaults (§5.3), resolution order (§6.2), and load tiers (§6.3); and preserves unknown types and unknown metadata keys.
**A conforming writer** generates unique ids, records `src` and `updated` truthfully, revises by supersession, and never silently deletes — removal goes through the archive.

## 13. Reference example

A complete, minimal store file:

```markdown
---
mnemo: "0.1"
scope: project
title: "shop-api — agent memory"
updated: 2026-08-09T14:02:00Z
budget: 3000
---

You are working on shop-api, a Fastify + PostgreSQL service.
Run tests with `npm test`; never commit directly to main.

## fact: CI runners use Node 20; node-gyp breaks on Node 22
`mnemo a7f3 | src: agent/2026-08-04 | conf: high | review: 2026-12-01`

Failed build: https://ci.example.com/runs/8841. Revisit when node-gyp ships v11.

## pref: Zivuch prefers prose explanations, no bullet points
`mnemo b2c9 | scope: user | src: user | pin: always`

## decision: Use PostgreSQL LISTEN/NOTIFY for cache invalidation, not Redis
`mnemo c4d1 | src: user/2026-06-12 | supersedes: 99e0`

Redis dropped to cut infra count. Revisit if we exceed ~500 notif/s.

## episode: 2026-08-09 — migrated payments module to the new client
`mnemo d5e2 | src: agent/2026-08-09 | ttl: 30d`

Touched 14 files; the retry wrapper in payments/retry.ts is load-bearing.
```

---

## Appendix A — Positioning

MnemoDB is infrastructure, not content: the embedded, file-based memory substrate for AI agents — SQLite's posture, not MySQL's. There is no server and no service; a store is files in a repo. Skill collections, agent frameworks, and memory engines are the intended *users* of MnemoDB, the applications above the substrate. The format competes with nothing that produces memories; it standardizes where they land. Database analogues, for orientation: the index (§6.1) is the query accelerator, load tiers (§6.3) are the cost optimizer (tokens, not I/O), compaction (§8) is vacuum, and the merge rules (§7.3) are the replication story. The query *engine* itself is deliberately outside the format (§2 non-goals): retrieval speed is an engine-layer concern, so the format stays simple enough that every tool can implement it.

## Appendix B — Roadmap to v1.0

- **v0.2:** formal EBNF grammar; JSON Schema for metadata; conformance test suite.
- **v0.3:** reference library (Rust core; WASM/JS and Python bindings) with `parse / index / merge / compact / migrate` commands.
- **v0.4:** integrations — adapters for the major agent frameworks and coding agents; a git merge driver.
- **v1.0:** freeze after ≥2 independent interoperable implementations; then (and only then) consider standards-body submission.

## Appendix C — Prior art and interoperability

MnemoDB positions itself as the storage substrate that existing agent-file conventions can write to — infrastructure under them, not a competitor to them. Known conventions in the wild map cleanly onto MnemoDB entries, and conforming `migrate` tooling SHOULD support importing them:

| Convention (example source) | MnemoDB mapping |
|---|---|
| `CLAUDE.md` / `AGENTS.md` standing instructions | Preamble (verbatim), or `pref`/`fact` entries with `src: user`, `pin: always` |
| Domain vocabulary files (e.g. `CONTEXT.md` in mattpocock/skills) | `fact` entries, `tags: vocabulary`; one entry per term, "Avoid" synonyms in the body |
| Learning records (`learning-records/0001-slug.md`, ADR-style, with `superseded by` status) | `insight` entries; their supersession status maps directly to `supersedes` |
| Session handoff documents | `episode` entries with default TTL, compactable into `fact`/`decision`/`insight` |
| ADRs (`adr/0001-*.md`) | `decision` entries; body carries the context/consequences sections |

The convergent evolution here — supersession, per-project scoping, compaction of sessions into durable notes — is treated as evidence for the model in §5–§8. Where a convention has richer structure than MnemoDB (e.g. ADR sections), the structure lives in the entry body; nothing is lost in translation.

## Appendix D — Open questions for reviewers

1. Should the metadata line use inline code (current: renders visibly, survives all Markdown tooling) or an HTML comment (invisible when rendered, but stripped by some pipelines)?
2. Is `##` the right entry delimiter, or should depth be flexible to allow grouping entries under `#` sections?
3. Should `conf` be an enum (current) or a 0–1 float? Enums are human-writable; floats are what retrieval systems want.
4. Do we need a `who` field distinct from `src` for multi-user / multi-agent teams?
5. Minimum viable crypto: is VCS-layer signing (§10.4) truly enough for shared/team stores?

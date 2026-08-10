# MnemoDB — Phase 0 Report

**Date:** 2026-08-10
**Verdict: GATE PASSED — GO for Phase 1**, with two spec revisions (already applied to SPEC v0.1).

Phase 0 had three parts: reserve the names, review the competitors, and hand-validate the format before writing any product code. All three are complete.

---

## 1. Namespace claim — done

GitHub org `mnemodb`, npm org/scope `@mnemodb`, and npm package `mnemodb@0.0.1` (published by zivuch, bundling the spec) were all secured on 2026-08-10. No outstanding reservation work.

## 2. Competitor review

**engramdb** (npm, v0.2.2, 03/2026). Storage: a single opaque SQLite database (default `~/.global-agent-memory.db`) via better-sqlite3 + sqlite-vec, with 768-dim local embeddings (nomic-embed-text via @huggingface/transformers). Retrieval: weighted nearest-neighbor (similarity 60% / importance 25% / recency 15%). Distribution: MCP server for Claude Desktop, Cursor, VS Code. Strengths: real semantic search, zero-config, cross-project global scope, conversation logging tools. Weaknesses vs MnemoDB's thesis: the store is invisible — not human-readable, not reviewable in a PR, not git-mergeable, not portable to another tool; one global DB in the home directory means no per-project versioning; embeddings model download is a heavy install.

**memvault** (npm, 04/2026). Storage: the user's own Postgres via Prisma; tenant isolation at query level; TTL support; MIT; explicitly anti-SaaS ("no cloud, no $249/mo"). Target: developers building agent *applications* (Vercel AI SDK / OpenAI / Anthropic tool integrations), more than coding-agent end users. Weaknesses vs the thesis: requires a running database server; memories live in SQL rows — again not diffable, not in the repo, not portable between frameworks.

**thebtf/engram** (GitHub, for context). PostgreSQL 17 + pgvector behind a gRPC daemon with MCP stdio forwarding, encrypted credential vault, rule governance. The maximalist end of the spectrum — infrastructure-heavy, 4 stars, illustrates where engine-first designs trend.

**Conclusions.** (1) The thesis holds: every surveyed system is engine-first with opaque storage; none offers a portable, human-auditable, git-native file format. MnemoDB's positioning survives contact with the field. (2) Adopt from them: engramdb's weighted recall (similarity/importance/recency) is a good default ranking for the v0.1 engine's BM25 layer, and its `importance` knob maps to our `conf`+`pin`. (3) A realistic future is symbiosis: engines like these could *index* MnemoDB stores — the SQLite-under-someone-else's-app model — which is worth a line in outreach.

## 3. Hand-validation on a real store

Built a live dogfood store — `.memory/` for the MnemoDB project itself — from this project's real history: 14 entries across `project.mem.md`, `user.mem.md`, `archive.mem.md`, and one episode file, exercising all seven entry types, supersession (the AMF→MnemoDB rename is entry `n4m1` superseding archived `a0f1`), scopes, pins, TTL, and `review` dates. The store is included alongside this report.

A ~40-line scratch parser (validation tooling, not product code) parsed all 14 entries with zero errors and zero grammar ambiguities: front matter, heading `type: statement` split, inline-code metadata line, id uniqueness — all clean on first try. Authoring by hand felt natural; the metadata line is easy to type and pleasant to read.

**Measured finding:** the derived index is only ~2.2× smaller than this store, not the spec's claimed 10–20× — because hand-written bodies are terse. The claim was honest about mature stores but wrong as a general statement. **Spec revised** (§6.1) to state compression scales with body length: ~2× terse → 10×+ evidence-rich.

## 4. Merge and concurrency experiments (git, real)

- **EXP1 — dual EOF-append, default git merge: CONFLICT.** Two branches each appending one entry at end-of-file — the *most common* agent write pattern — do not merge under git's line-based default. The spec's "almost always succeeds" was wrong where it matters most.
- **EXP2 — same scenario with `*.mem.md merge=union` in `.gitattributes`: merges cleanly.** One caveat observed: the union driver drops the blank line between the two appended entries, so parsers must not depend on blank-line separation (the scratch parser already didn't — entries end at the next `##` heading).
- **EXP3 — supersession race:** two branches each superseding the same entry (`l1cx`) with different new entries merges cleanly under union, leaving two live contradictory decisions — exactly the case spec §7.3 rule 4 assigns to tooling-level contradiction detection. Confirmed by experiment, no spec change needed.

**Spec revised** (§7.3): stores MUST ship `.gitattributes` with `merge=union` (written by `init`), and parsers MUST NOT require blank-line separation between entries. Both revisions are already in SPEC v0.1.

## 5. Evidence toward the open questions (spec Appendix D)

- **Q1 (inline code vs HTML comment for metadata):** leaning strongly to inline code — hand-authoring was effortless, it renders visibly (useful, not noisy), and it survived git merges and the union driver intact. Recommend closing as inline code in v0.2 unless Phase 1–3 dogfooding contradicts.
- **Q3 (conf enum vs float):** the enum was never limiting during hand-authoring; engramdb's float importance mainly feeds ranking weights, which the engine can derive from enum+pin. Keep the enum, revisit only if engine evals demand it.
- Q2, Q4, Q5: no evidence yet; carry to Phase 1–3.

## 6. Carried-over open items

Licenses (Apache-2.0 / CC BY 4.0 proposed) and repo strategy (monorepo recommended) remain user decisions before Phase 1 code. The store's `todo` entries track both — and the merge experiment incidentally demonstrated why deciding soon matters: two agents "deciding" licensing independently produced the textbook contradiction case.

## 7. Gate verdict

The format survived real authoring, parsing, merging, and a supersession race with only two revisions, both already applied. Per the plan's gate — "survives real use with no more than minor revisions" — **Phase 0 passes. Phase 1 (`@mnemodb/core` + `mnemo` CLI, TypeScript) is cleared to start.** First Phase 1 tasks in order: repo scaffold with the license/monorepo decisions, then parser/serializer with round-trip byte-stability against the dogfood store as fixture #1 — this store should be committed to the repo as the seed of the conformance corpus.

# Roadmap

MnemoDB is **v0.1 — early**. This is a direction, not a set of promises: what
gets built next is driven by what real use proves necessary, so priorities here
will shift with feedback. If something below matters to you — or something not
listed does — [open an issue](https://github.com/mnemodb/mnemodb/issues) and say
so. That's how items move up.

## Shipped (v0.1.x)

- The `.mem.md` format and spec (v0.1 draft).
- `@mnemodb/core` — parse, byte-stable serialize, index, resolve, TTL lifecycle,
  CRDT merge, compaction, migration importers, `doctor` validation.
- `@mnemodb/cli` — `init`, `list`, `show`, `doctor`, `compact`, `migrate`.
- `@mnemodb/mcp` — 11 memory-semantic tools (recall, list, show, history, stats,
  remember, forget, pin, review, compact, boot).
- Security: provenance + trust model, injection defense, adversarial ship-gate.
- i18n search for space-delimited scripts (Hebrew, Cyrillic, Arabic, Greek…),
  plus CJK / Japanese / Thai word-segmentation via `Intl.Segmenter`.
- Retrieval-accuracy benchmark — labeled query→expected fixtures with
  precision@k / recall@k / MRR, a `npm run bench` report, and a CI regression
  guard (`packages/mcp/bench/`).
- **Claude Code plugin** — MCP server + `agent-memory` skill + session-start
  hook, so memory works on install (`/plugin marketplace add mnemodb/mnemodb`).
  The MCP store is pinned to the project root, so writes can't scatter.
- Native-memory import — `mnemo migrate <dir> --claude-memory` brings a Claude
  Code memory dir into typed `.mem.md` form.

## Likely next (v0.2 candidates)

Ordered by current guess at leverage; real use may reorder them.

- **Git merge driver** — wire the existing CRDT merge (`mergeDocs`) in as a real
  git merge driver, so two branches editing the *same* entry's body resolve
  automatically instead of throwing a line conflict.
- **`migrate` + `init` clarity** — today running both leaves an orphan
  `*.mem.md` next to the store; `migrate` should place output into `.memory/` or
  warn. (Audit finding #4.)
- **Bound-prefix retrieval for Hebrew/Arabic** — prefix-aware matching so a
  query for a bare word also matches its ה/ב/ל-prefixed forms. (CJK/Japanese/Thai
  word-segmentation already shipped.)
- **`doctor` / `list` polish** — distinguish damaged entries from
  superseded/expired in output; richer health summaries.
- **Deterministic conformance fixtures** — fixed ids so the corpus is stable.

## Directions (later / exploratory)

- **Semantic search** — optional embedding-based recall alongside keyword, for
  paraphrase and cross-lingual queries. The retrieval benchmark now quantifies
  the gap it targets: keyword recall scores ~100% on exact queries but only
  ~60% recall / ~20% hit@1 on paraphrases (a ~40-point recall gap). Build it
  against that fixture set so any gain is measured, not assumed — it stays a
  heavier optional dependency until the numbers justify it.
- **Adapter for Claude's native memory tool** — the *import* direction shipped
  in 0.1.6 (`mnemo migrate --claude-memory` reads a native-memory dir into
  `.mem.md`). Still open: the reverse — let Claude's built-in memory *write*
  `.mem.md` directly, so you get its auto-capture *plus* MnemoDB's structure,
  portability, and auditability. Complement, not competitor.
- **Persistent index** — use `manifest.mem.md` as a real cache for very large
  stores (tens of thousands of entries).
- **Entry relations** — explicit links between memories (see-also / caused-by),
  a knowledge-graph-lite layer.
- **More convention importers** — CONTEXT.md vocabularies, learning-records, ADRs
  (spec Appendix C).

## Post-1.0

- Cryptographic signing of entries; multi-user / team stores with per-user
  provenance. Deferred until the single-user format is proven and stable.

## Spec

The v0.1 spec's open questions (Appendix D — metadata syntax, `conf` as enum vs
float, etc.) close into **spec v0.2** after a round of real-world use. The spec
stays explicitly unstable (breaking changes allowed) until v1.0, which freezes
only after ≥2 independent interoperable implementations exist.

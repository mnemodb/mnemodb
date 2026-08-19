# Changelog

All notable changes to MnemoDB are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/). All packages
(`@mnemodb/core`, `@mnemodb/cli`, `@mnemodb/mcp`, and the `mnemodb` umbrella)
are versioned together.

## [0.1.11] — 2026-08-17

`@mnemodb/mcp` now ships as a single **zero-dependency bundle**, so
`npx @mnemodb/mcp` cold-starts in ~100ms instead of ~10s+.

The slow part of `npx -y @mnemodb/mcp` was downloading the whole
`@modelcontextprotocol/sdk` + `zod` + `@mnemodb/core` dependency tree on first
launch — which exceeded Claude Code's MCP startup timeout (`MCP_TIMEOUT`) and
left the plugin's server disconnected at session start, needing a manual
reconnect. Bundling removes the download entirely.

- The server (`bin: mnemo-mcp`) is esbuild-bundled with all dependencies inlined;
  the published package has **no runtime `dependencies`** and ships only the
  bundle (`dist/server.js`).
- No behavior change — same 11 tools, same engine; packaging only.
- New regression tests assert the package stays dependency-free and the bundle
  runs standalone (no `node_modules`) through a real tool call.
- `@mnemodb/mcp` is now published as a server binary only (`main`/`types`
  removed); use `@mnemodb/core` for the engine as a library.

## [0.1.10] — 2026-08-17

Security and correctness hardening from a full adversarial audit. 22 new
regression tests (the suite runs as a ship gate on every publish).

### Security
- **Unclosed-fence poisoning fixed.** A stray ``` ``` ``` in a memory body could
  leave an open code fence that swallowed later entries — persistently bricking
  `remember`, silently no-op'ing `forget`, and hiding entries from `doctor`.
  Bodies are now fence-balanced on write, `forget` fails closed, and `doctor`
  flags an unclosed fence.
- **Provenance can no longer be spoofed.** Trust is decided on a canonical `src`
  (NFC + first segment + trim + lowercase) and fails *closed* to the
  least-privileged tier, so `src: Tool` / `TOOL` / `tool ` can't bypass the
  supersede bar, the `forged-supersede` check, or the `untrusted` flag.
- **Supply chain.** The plugin now pins the server to an exact version
  (`@mnemodb/mcp@0.1.10`) instead of always pulling latest; a new tag-triggered
  workflow publishes all packages with npm **provenance** (sigstore); CI/release
  actions are pinned to commit SHAs.

### Correctness / data safety
- `mergeDocs`: no longer glues adjacent entries (silent data loss), respects
  trust when resolving same-id revisions (a lower-trust copy can't win),
  surfaces preamble/front-matter divergence instead of dropping one side, and
  converges byte-for-byte regardless of argument order.
- Compaction writes the archive **first**, so an interrupted run leaves
  recoverable duplicates rather than lost entries.
- The store lock fails fast on an unusable path (no CPU-spin) and won't break a
  lock held by a live process (no lost writes).
- `planCompaction` is now pure (preview/replan can't corrupt the store); imports
  can't mint an id that collides with an existing one.

### Retrieval
- **CJK / Japanese / Thai memories are searchable** via `Intl.Segmenter` word
  segmentation (previously they stored fine but returned nothing).
- Query tokens are deduped so keyword-stuffing can't inflate score; `history`
  returns the full supersession lineage, not just the first predecessor.

### Fixes & docs
- Version drift resolved: the MCP server derives its version from `package.json`;
  plugin/marketplace manifests aligned. Spec corrected (id grammar vs the ULID
  recommendation; the untyped-entry definition now matches the parser). The CLI
  prints a friendly one-line error on a bad store instead of a stack trace;
  `generateId` uses a crypto RNG; new `doctor` `ttl-no-anchor` check.

## [0.1.9] — 2026-08-12

The Windows atomic-write fix finally reaches npm. 0.1.6–0.1.8 all shipped a
**stale `dist`**: `tsc -b` (incremental) reused cached compiled output and never
recompiled `compact.js`, so the source fix never made it into the published
tarball. The `build` script now runs `tsc -b --force`, guaranteeing a clean
compile before every publish. No source changes vs 0.1.8 — this is the same fix,
actually compiled in.

## [0.1.8] — 2026-08-12

Intended to ship the 0.1.7 Windows fix; the published `dist` was stale (see
0.1.9). Superseded by 0.1.9.

## [0.1.7] — 2026-08-12

### Fixed
- `writeFileAtomic` is now robust on Windows: it writes the temp file in the
  target's own directory (no cross-device rename), scopes the temp name by
  pid + sequence so concurrent writers can't collide, and retries `renameSync`
  on transient `EPERM`/`EBUSY`/`EACCES` (antivirus/indexer file locks). This
  fixes intermittent `EPERM` failures under concurrent writes — and the flaky
  `prepublishOnly` test run that could abort `npm publish`.

### Housekeeping
- Removed an accidentally-committed delivery tarball; `.gitignore` now excludes
  `*.tar`.

## [0.1.6] — 2026-08-12

Ship the Claude Code plugin for real, make writes land where you look for them,
and position MnemoDB honestly next to a platform's built-in memory.

### Added
- **Claude Code plugin** (`mnemodb`) — bundles the MCP server, an `agent-memory`
  skill, and a session-start hook, so memory works on install with no `CLAUDE.md`
  snippet to paste (`/plugin marketplace add mnemodb/mnemodb`).
- `mnemo migrate <dir> --claude-memory` — import a Claude Code native-memory
  directory (`~/.claude/projects/<p>/memory/`) as typed entries, to graduate an
  existing native-memory corpus into portable, auditable `.mem.md` form.
- `examples/trust-model-demo.mjs` — a runnable demonstration of the trust model:
  a tool-sourced (untrusted) memory can neither supersede nor forget a user rule.
- Security ship-gate extended to the `forget`/`pin` write paths; the plugin ships
  its own adversarial test suite, run in CI.

### Fixed
- The plugin's MCP server now pins the store to the project root via
  `MNEMO_STORE=${CLAUDE_PROJECT_DIR}`, so `memory_remember` writes always land in
  the project's store instead of wherever the server's working directory happened
  to be — the "wrote a memory but `mnemo list` is empty" failure.
- Plugin manifest no longer double-declares the standard `hooks/hooks.json`
  (Claude Code auto-loads it), which caused a "Duplicate hooks file" load error.

### Changed
- The plugin skill and hook now position MnemoDB for durable, structured,
  portable, trusted memory — decisions, facts, and preferences worth keeping
  deliberately — rather than as a replacement for a platform's automatic memory,
  which a tool call structurally cannot match at silent auto-capture.

## [0.1.5] — 2026-08-11

The memory-semantic tool surface — the answer to "why this over a plain memory
folder." Five new MCP tools that operate on structure a generic file-ops memory
tool has no concept of.

### Added
- `memory_show` — one entry in full (body, metadata, provenance, lifecycle status).
- `memory_history` — an entry's supersession lineage: what it replaced and what
  replaced it. Memory over time; a folder has no history.
- `memory_stats` — the store's self-report: counts by type/scope/provenance,
  always-pinned count, staleness, and always-tier token load vs budget.
- `memory_forget` — auditable soft-delete: supersede with a cold tombstone
  (recoverable, never a hard delete). Trust-gated — cannot forget a higher-trust
  (user) entry, so an injected "forget X" can't erase what the user told you.
- `memory_pin` — set an entry's load tier (always/auto/cold) to control the
  context budget. Guard: a tool-sourced entry cannot be pinned to `always`.

The MCP server now exposes 11 tools. 54 tests, including trust-guard regressions
for forget and pin.

## [0.1.4] — 2026-08-11

### Added
- `memory_list` MCP tool — list the entire store from inside the agent (no query
  needed), the in-agent equivalent of `mnemo list`. Filters by scope/type and can
  include archived (superseded/expired) entries. You can now ask an agent "list
  my memories" instead of shelling out to the CLI.

## [0.1.3] — 2026-08-11

Documentation-only release. No code changes.

### Changed
- npm-facing package READMEs (`mnemodb`, `@mnemodb/mcp`) rewritten with a clear
  what / why / how, including how MnemoDB relates to `CLAUDE.md` and Claude's
  native memory tool: not a replacement, but the structure, lifecycle,
  provenance, portability, and auditability layer they don't provide.
- Root README rewritten to match.

## [0.1.2] — 2026-08-10

Security-hardening release from a full adversarial audit
(`spec/AUDIT-2026-08-10.md`, addendum 2). **All users should upgrade.**

### Security
- **CRITICAL — structural injection.** A crafted `statement` or `body` passed to
  `memory_remember` could forge additional entries with escalated provenance
  (`src: user`) and `pin: always`, letting content derived from tool output or a
  web page plant a trusted, pinned instruction into every future session. Fixed
  with core-level sanitization on every write path plus a fail-closed re-parse
  backstop in `remember`.
- **CRITICAL — supersede forgery.** A `tool`-sourced entry could supersede and
  hide a user's entries. Supersession is now trust-gated (spec §10): tool-sourced
  entries may not supersede user/agent entries. Enforced at resolution and write
  time; `doctor` reports `forged-supersede` for edges arriving via hand-edit or
  merge. Agent↔user revisions are unaffected.
- **HIGH — control-character/bidi/zero-width spoofing.** NUL, C0/C1 controls,
  RTL/LTR overrides, zero-width and BOM characters are now stripped on write.
- Size caps: statement ≤ 2000 chars, body ≤ 100 000, tags ≤ 32 × 80.

### Added
- `packages/mcp/test/security.test.js` — a 10-test adversarial suite, run as a
  CI ship gate and via `prepublishOnly` before every publish.
- `doctor` rule `forged-supersede`.
- Core exports: `sanitizeStatement`, `sanitizeBody`, `sanitizeTags`, `trustRank`,
  `forgedSupersedes`, and size-limit constants.

### Fixed
- Unicode normalization (NFC) applied on write and in search, closing a
  dedup-bypass where NFC/NFD variants were treated as distinct.

## [0.1.1] — 2026-08-10

First audited release; supersedes 0.1.0 (do not use 0.1.0).

### Security
- `memory_recall` now returns each entry's provenance (`src`) and an `untrusted`
  flag; `bootContext` tags tool-sourced pinned entries. Previously the trust
  data required by the injection defense never reached the consuming agent.

### Added
- Fence-aware parsing: fenced code blocks containing `## ` lines no longer split
  into phantom entries.
- Cross-process writer lock (`withStoreLock`) serializing `remember` and
  `compact --write`; concurrent writers no longer lose updates.
- Unicode-aware search tokenizer — Hebrew, Cyrillic, Arabic, Greek and other
  space-delimited scripts are now searchable (previously non-ASCII was
  unsearchable). CJK word-segmentation remains a v0.2 item.
- `init` now writes a `.gitignore` for the transient writer lock.

### Fixed
- CRLF (Windows checkout) documents parse with correct entry types and stay
  byte-stable.
- Store walk tolerates entries vanishing mid-scan and skips dot-directories.
- `repository.url` normalized in all package manifests.

## [0.1.0] — 2026-08-10 — deprecated

Initial public release. **Withdrawn in favor of 0.1.1+**: contained
fence-splitting, lost-update, non-ASCII search, and provenance defects found in
audit. Left published for history; not recommended for use.

### Added
- The MnemoDB v0.1 draft specification (`spec/SPEC-v0.1.md`).
- `@mnemodb/core` — parse, byte-stable serialize, index, resolve, TTL lifecycle,
  CRDT merge, compaction, migration importers, and store validation (`doctor`).
- `@mnemodb/cli` (`mnemo`) — `init`, `list`, `show`, `doctor`, `compact`, `migrate`.
- `@mnemodb/mcp` — memory engine as an MCP server: `memory_recall`,
  `memory_remember`, `memory_review`, `memory_compact`, `memory_boot`.
- Conformance fixtures, including the project's own dogfood memory store.

[0.1.11]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.11
[0.1.10]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.10
[0.1.9]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.9
[0.1.8]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.8
[0.1.7]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.7
[0.1.6]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.6
[0.1.5]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.5
[0.1.4]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.4
[0.1.3]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.3
[0.1.2]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.2
[0.1.1]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.1
[0.1.0]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.0

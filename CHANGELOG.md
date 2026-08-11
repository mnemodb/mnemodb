# Changelog

All notable changes to MnemoDB are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/). All packages
(`@mnemodb/core`, `@mnemodb/cli`, `@mnemodb/mcp`, and the `mnemodb` umbrella)
are versioned together.

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

[0.1.3]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.3
[0.1.2]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.2
[0.1.1]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.1
[0.1.0]: https://github.com/mnemodb/mnemodb/releases/tag/v0.1.0

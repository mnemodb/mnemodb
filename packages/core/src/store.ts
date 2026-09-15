/**
 * Store loading (spec §3): single-file mode or .memory/ directory mode.
 * Also implements index derivation (§6.1), resolution (§6.2), and load
 * tiers (§6.3) over the loaded documents.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { parse } from './parse.js';
import { isExpired } from './lifecycle.js';
import { trustRank } from './sanitize.js';
import type { Conf, Entry, IndexEntry, MemDoc, Pin } from './types.js';

export interface Store {
  root: string;
  docs: MemDoc[];
}

const MEM_FILE_RE = /\.mem\.md$/;
const FALLBACK_FILES = ['MEMORY.mem.md', 'CLAUDE.md', 'AGENTS.md'];

/** Load a store from a directory (looks for .memory/ or *.mem.md) or a single file. */
export function loadStore(target: string): Store {
  const st = statSync(target);
  if (st.isFile()) {
    return { root: target, docs: [parseFile(target, target)] };
  }
  const memoryDir = join(target, '.memory');
  const hasMemoryDir = existsSync(memoryDir);
  const root = hasMemoryDir ? memoryDir : target;
  const files = walk(root).filter((f) => MEM_FILE_RE.test(f));
  // A store scattered by <= 0.1.11 left `*.mem.md` at the PROJECT ROOT instead
  // of inside `.memory/`. Once `.memory/` exists those files would stop being
  // loaded, silently hiding memories the user already had — so keep reading
  // them. Their `doc.path` resolves as `../name.mem.md`, so `forget`/`pin`
  // still write back to the original file, and `doctor` flags them to be
  // consolidated into `.memory/`.
  if (hasMemoryDir) files.push(...legacyRootFiles(target));
  if (files.length === 0) {
    for (const name of FALLBACK_FILES) {
      const p = join(target, name);
      if (existsSync(p)) files.push(p);
    }
  }
  return { root, docs: files.map((f) => parseFile(f, root)) };
}

/**
 * Canonical directory a *write* (a new `.mem.md` file) must target for a given
 * store location. Reads (`loadStore`) accept a bare project dir, a `.memory/`
 * dir, or a single file — but a newly created file must always land inside
 * `.memory/`, so writes never scatter into the project root.
 *
 * The bug this fixes (chicken-and-egg): `loadStore` falls back to `target`
 * itself when no `.memory/` exists yet, so the very first `memory_remember`
 * used to write `project.mem.md` loose at the project root and `.memory/` was
 * never born — making `mnemo init` feel mandatory. This resolves a bare
 * project dir to `<dir>/.memory` (the caller creates it), so the folder appears
 * on the first write with no init step.
 *
 * - `target` is already named `.memory` → returned unchanged (created or not)
 * - single-file store (`target` is a file) → returned unchanged (caller owns it)
 * - anything else (existing project dir, or a path yet to be created) → `<dir>/.memory`
 */
export function resolveWriteDir(target: string): string {
  // Check the name FIRST: a target already named `.memory` is the store dir
  // whether or not it exists yet. Deciding this after the stat meant a path
  // pointing at a not-yet-created `.memory/` fell through to the "doesn't
  // exist" branch and nested a second one (`<dir>/.memory/.memory`).
  if (basename(target) === '.memory') return target;
  let st;
  try { st = statSync(target); }
  catch { return join(target, '.memory'); } // not created yet → treat as a project dir
  if (st.isFile()) return target;             // single-file store: unchanged
  return join(target, '.memory');             // project dir → canonical .memory/
}

/**
 * Top-level `*.mem.md` files sitting BESIDE a `.memory/` dir — the layout a
 * pre-0.1.12 store was left in when the first write scattered into the project
 * root. Only the target's own directory is scanned (never recursively), so an
 * unrelated `.mem.md` deeper in the repo is not swept into the store.
 */
function legacyRootFiles(target: string): string[] {
  const out: string[] = [];
  let names: string[];
  try { names = readdirSync(target); } catch { return out; }
  for (const name of names) {
    if (!MEM_FILE_RE.test(name)) continue;
    const p = join(target, name);
    try { if (statSync(p).isFile()) out.push(p); } catch { /* vanished */ }
  }
  return out.sort();
}

function parseFile(path: string, root: string): MemDoc {
  const doc = parse(readFileSync(path, 'utf8'), relative(root, path) || path);
  return doc;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    // Skip dot-entries (.git, .mnemo-lock, .DS_Store, editor temp dirs).
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; } // vanished between readdir and stat
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

/** Derive the store index: headings + metadata, no bodies (spec §6.1). */
export function deriveIndex(store: Store, opts?: { includeCold?: boolean }): IndexEntry[] {
  const index: IndexEntry[] = [];
  for (const doc of store.docs) {
    const fileScope = doc.frontMatter?.scope ?? 'project';
    for (const e of doc.entries) {
      const pin = (e.meta.pin ?? 'auto') as Pin;
      if (pin === 'cold' && !opts?.includeCold) continue;
      index.push({
        type: e.type,
        id: e.meta.id ?? null,
        statement: e.statement,
        pin,
        scope: e.meta.scope ?? fileScope,
        file: doc.path ?? '',
        line: e.line,
        supersedes: e.meta.supersedes ?? [],
        tags: e.meta.tags ?? [],
        updated: e.meta.updated ?? doc.frontMatter?.updated,
        conf: (e.meta.conf ?? 'med') as Conf,
      });
    }
  }
  return index;
}

/**
 * All ids superseded by any entry — but ONLY where the superseding entry's
 * trust rank is >= the target's (spec §10; audit 2026-08-10). A lower-trust
 * entry (e.g. tool-sourced) cannot hide or erase a higher-trust one (e.g. a
 * user preference); such an edge is ignored so the target stays live, and
 * `doctor` reports it as a `forged-supersede`.
 */
export function supersededIds(store: Store): Set<string> {
  const srcById = new Map<string, string | undefined>();
  for (const doc of store.docs) {
    for (const e of doc.entries) if (e.meta.id) srcById.set(e.meta.id, e.meta.src);
  }
  const ids = new Set<string>();
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      for (const id of e.meta.supersedes ?? []) {
        if (supersedeAllowed(e.meta.src, srcById.get(id))) ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Trust rule for supersession (spec §10; audit 2026-08-10): the only barred
 * case is a `tool`-sourced entry hiding a NON-tool (user/agent) entry — the
 * prompt-injection escalation path. Agent and user are mutually trusted (the
 * agent acts for the user), so everyday revisions are unaffected.
 */
function supersedeAllowed(superSrc: string | undefined, targetSrc: string | undefined): boolean {
  if (targetSrc === undefined) return true; // superseding an unknown/foreign id
  return !(trustRank(superSrc) === 1 && trustRank(targetSrc) > 1);
}

/** Supersede edges refused because a tool-sourced entry targeted a trusted one. */
export function forgedSupersedes(store: Store): { by: string; target: string }[] {
  const srcById = new Map<string, string | undefined>();
  for (const doc of store.docs) {
    for (const e of doc.entries) if (e.meta.id) srcById.set(e.meta.id, e.meta.src);
  }
  const out: { by: string; target: string }[] = [];
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      for (const id of e.meta.supersedes ?? []) {
        if (srcById.has(id) && !supersedeAllowed(e.meta.src, srcById.get(id))) {
          out.push({ by: e.meta.id ?? '?', target: id });
        }
      }
    }
  }
  return out;
}

export interface LiveEntry { entry: Entry; doc: MemDoc; scope: string }

/**
 * Live entries (spec §6.2): not superseded, not expired.
 * Sorted by scope precedence: episode > project > user, then file order.
 */
export function liveEntries(store: Store, now: Date = new Date()): LiveEntry[] {
  const dead = supersededIds(store);
  const rank: Record<string, number> = { episode: 0, project: 1, user: 2 };
  const out: LiveEntry[] = [];
  for (const doc of store.docs) {
    const fileScope = doc.frontMatter?.scope ?? 'project';
    for (const entry of doc.entries) {
      if (entry.meta.id && dead.has(entry.meta.id)) continue;
      if (isExpired(entry, now)) continue;
      out.push({ entry, doc, scope: entry.meta.scope ?? fileScope });
    }
  }
  return out.sort((a, b) => (rank[a.scope] ?? 1) - (rank[b.scope] ?? 1));
}

/** Entries in the always-load tier (spec §6.3), preamble excluded. */
export function alwaysTier(store: Store, now?: Date): LiveEntry[] {
  return liveEntries(store, now).filter((l) => l.entry.meta.pin === 'always');
}

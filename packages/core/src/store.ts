/**
 * Store loading (spec §3): single-file mode or .memory/ directory mode.
 * Also implements index derivation (§6.1), resolution (§6.2), and load
 * tiers (§6.3) over the loaded documents.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from './parse.js';
import { isExpired } from './lifecycle.js';
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
  const root = existsSync(memoryDir) ? memoryDir : target;
  const files = walk(root).filter((f) => MEM_FILE_RE.test(f));
  if (files.length === 0) {
    for (const name of FALLBACK_FILES) {
      const p = join(target, name);
      if (existsSync(p)) files.push(p);
    }
  }
  return { root, docs: files.map((f) => parseFile(f, root)) };
}

function parseFile(path: string, root: string): MemDoc {
  const doc = parse(readFileSync(path, 'utf8'), relative(root, path) || path);
  return doc;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.git') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
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

/** All ids superseded by any entry in the store. */
export function supersededIds(store: Store): Set<string> {
  const ids = new Set<string>();
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      for (const id of e.meta.supersedes ?? []) ids.add(id);
    }
  }
  return ids;
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

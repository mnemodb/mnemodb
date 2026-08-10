/**
 * Compaction — the vacuum pass (spec §8), steps 1 and 4:
 * move expired and superseded entries to the archive (pin: cold), and
 * report what moved. Episode distillation (step 2) and contradiction
 * resolution (step 3) are agent-level work, out of scope for the library.
 *
 * Loss-auditable by construction: every removed entry lands in the archive
 * in the same operation; plan() never mutates, apply() writes atomically.
 */
import { writeFileSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { serialize, serializeEntry } from './serialize.js';
import { supersededIds } from './store.js';
import { isExpired } from './lifecycle.js';
import type { Store } from './store.js';
import type { Entry, MemDoc } from './types.js';

export interface CompactMove {
  id: string | null;
  type: string;
  statement: string;
  from: string;
  reason: 'superseded' | 'expired';
}

export interface CompactPlan {
  moves: CompactMove[];
  /** Documents in their post-compaction form (archive last). Untouched docs excluded. */
  changed: MemDoc[];
}

const ARCHIVE_NAME = 'archive.mem.md';

function isArchive(doc: MemDoc): boolean {
  return basename(doc.path ?? '') === ARCHIVE_NAME;
}

/** Compute the compaction plan. Pure: does not touch the filesystem. */
export function planCompaction(store: Store, now: Date = new Date()): CompactPlan {
  const archive = store.docs.find(isArchive);
  if (!archive) {
    return { moves: [], changed: [] }; // single-file mode: nothing to move into
  }
  const dead = supersededIds(store);
  const moves: CompactMove[] = [];
  const changed = new Set<MemDoc>();
  const toArchive: Entry[] = [];

  for (const doc of store.docs) {
    if (isArchive(doc)) continue;
    const keep: Entry[] = [];
    for (const e of doc.entries) {
      const superseded = e.meta.id ? dead.has(e.meta.id) : false;
      const expired = isExpired(e, now);
      if (superseded || expired) {
        moves.push({
          id: e.meta.id ?? null, type: e.type, statement: e.statement,
          from: doc.path ?? '', reason: superseded ? 'superseded' : 'expired',
        });
        toArchive.push({
          ...e,
          meta: { ...e.meta, pin: 'cold' },
          dirty: true, // regenerate with pin: cold
        });
        changed.add(doc);
      } else {
        keep.push(e);
      }
    }
    doc.entries = keep;
  }

  if (toArchive.length > 0) {
    for (const e of toArchive) {
      const last = archive.entries.at(-1);
      const prevText = last ? last.raw : archive.preamble;
      const needsGap = prevText !== '' && !prevText.endsWith('\n\n');
      let block = serializeEntry(e);
      if (!block.endsWith('\n')) block += '\n';
      archive.entries.push({ ...e, raw: (needsGap ? '\n' : '') + block, dirty: false });
    }
    changed.add(archive);
  }

  return { moves, changed: [...changed] };
}

/** Apply a plan: atomic write (temp file + rename) per changed document (spec §11). */
export function applyCompaction(store: Store, plan: CompactPlan): string[] {
  const written: string[] = [];
  for (const doc of plan.changed) {
    if (!doc.path) continue;
    const abs = join(store.root, doc.path);
    writeFileAtomic(abs, serialize(doc));
    written.push(doc.path);
  }
  return written;
}

/** Atomic replacement: write temp in same directory, then rename (spec §11). */
export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  const tmp = mkdtempSync(join(tmpdir(), 'mnemo-'));
  const tmpFile = join(tmp, 'out');
  try {
    writeFileSync(tmpFile, content);
    // rename across devices can fail; fall back to same-dir temp
    try {
      renameSync(tmpFile, path);
    } catch {
      const local = join(dir, `.${basename(path)}.tmp`);
      writeFileSync(local, content);
      renameSync(local, path);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

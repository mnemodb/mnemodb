/**
 * Compaction — the vacuum pass (spec §8), steps 1 and 4:
 * move expired and superseded entries to the archive (pin: cold), and
 * report what moved. Episode distillation (step 2) and contradiction
 * resolution (step 3) are agent-level work, out of scope for the library.
 *
 * Loss-auditable by construction: every removed entry lands in the archive
 * in the same operation; plan() never mutates, apply() writes atomically.
 */
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
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
  /** Documents in their post-compaction form. Untouched docs excluded;
   *  applyCompaction writes the archive before the source removals. */
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
  const changed: MemDoc[] = [];
  const toArchive: Entry[] = [];

  // Pure: build post-compaction COPIES of changed docs; never mutate the input
  // store (audit M1-core — planning twice, or previewing then declining, must
  // not corrupt the loaded store).
  for (const doc of store.docs) {
    if (isArchive(doc)) continue;
    const keep: Entry[] = [];
    let removedAny = false;
    for (const e of doc.entries) {
      const superseded = e.meta.id ? dead.has(e.meta.id) : false;
      const expired = isExpired(e, now);
      if (superseded || expired) {
        moves.push({
          id: e.meta.id ?? null, type: e.type, statement: e.statement,
          from: doc.path ?? '', reason: superseded ? 'superseded' : 'expired',
        });
        toArchive.push({ ...e, meta: { ...e.meta, pin: 'cold' }, dirty: true });
        removedAny = true;
      } else {
        keep.push(e);
      }
    }
    if (removedAny) changed.push({ ...doc, entries: keep });
  }

  if (toArchive.length === 0) return { moves, changed: [] };

  // Copy of the archive with the moved entries appended.
  const archiveCopy: MemDoc = { ...archive, entries: [...archive.entries] };
  for (const e of toArchive) {
    const last = archiveCopy.entries.at(-1);
    const prevText = last ? last.raw : archiveCopy.preamble;
    const needsGap = prevText !== '' && !prevText.endsWith('\n\n');
    let block = serializeEntry(e);
    if (!block.endsWith('\n')) block += '\n';
    archiveCopy.entries.push({ ...e, raw: (needsGap ? '\n' : '') + block, dirty: false });
  }

  // Archive first (applyCompaction also orders it first — audit H3).
  return { moves, changed: [archiveCopy, ...changed] };
}

/**
 * Apply a plan: atomic write (temp file + rename) per changed document (spec §11).
 *
 * Writes are per-file atomic but there is no cross-file transaction, so the
 * ARCHIVE is written FIRST and the source removals after. If a later write
 * throws (disk full, FS error), an interrupted run leaves the moved entries in
 * BOTH the archive and their source — recoverable duplicates that `doctor`
 * flags as duplicate-id — rather than lost from both (audit H3).
 */
export function applyCompaction(store: Store, plan: CompactPlan): string[] {
  const written: string[] = [];
  const ordered = [...plan.changed].sort(
    (a, b) => (isArchive(b) ? 1 : 0) - (isArchive(a) ? 1 : 0),
  );
  for (const doc of ordered) {
    if (!doc.path) continue;
    const abs = join(store.root, doc.path);
    writeFileAtomic(abs, serialize(doc));
    written.push(doc.path);
  }
  return written;
}

let atomicSeq = 0;

/** Synchronous backoff — lets a transient Windows file lock clear before retry. */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Atomic replacement: write a temp in the SAME directory, then rename over the
 * target (spec §11). Same-dir temp avoids cross-device rename (which EPERMs on
 * Windows when the OS tmpdir is a different volume). The temp name is scoped by
 * pid + sequence so concurrent writers never clobber each other's temp.
 *
 * On Windows, renameSync can transiently fail with EPERM/EBUSY/EACCES when an
 * antivirus scanner or the search indexer briefly holds the source or target;
 * retry with a short backoff before surfacing the error.
 */
export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  const local = join(dir, `.${basename(path)}.${process.pid}.${atomicSeq++}.tmp`);
  writeFileSync(local, content);
  let lastErr: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      renameSync(local, path);
      return;
    } catch (e) {
      lastErr = e as NodeJS.ErrnoException;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(lastErr.code ?? '')) break;
      sleepMs(20 * (attempt + 1)); // 20ms, 40ms, … ~200ms total
    }
  }
  try { rmSync(local, { force: true }); } catch { /* best effort */ }
  throw lastErr;
}

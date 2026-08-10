/**
 * Deterministic merge of two versions of a document (spec §7.3).
 *
 * State-based CRDT semantics:
 *  1. Entry set = grow-only set keyed by id (union; distinct ids never conflict).
 *  2. Same id both sides → later `updated` wins; tie → greater content hash.
 *  3. Supersession is monotonic (handled naturally by union of supersedes).
 *  4. Semantic contradictions are NOT resolved here — doctor flags them.
 *
 * Note: day-to-day merging goes through git's union driver (mandatory
 * .gitattributes, spec §7.3); this implements the full semantics for a
 * dedicated merge driver and for engine-level reconciliation.
 */
import { createHash } from 'node:crypto';
import type { Entry, MemDoc } from './types.js';

export function mergeDocs(ours: MemDoc, theirs: MemDoc): MemDoc {
  const merged: MemDoc = {
    frontMatter: ours.frontMatter ?? theirs.frontMatter,
    frontMatterRaw: ours.frontMatterRaw ?? theirs.frontMatterRaw,
    preamble: ours.preamble.length >= theirs.preamble.length ? ours.preamble : theirs.preamble,
    entries: [],
    diagnostics: [...ours.diagnostics],
    path: ours.path,
  };

  const byId = new Map<string, Entry>();
  const anonymous: Entry[] = [];
  const order: string[] = [];

  const take = (e: Entry) => {
    const id = e.meta.id;
    if (!id) { anonymous.push(e); return; }
    const existing = byId.get(id);
    if (!existing) { byId.set(id, e); order.push(id); return; }
    byId.set(id, pickRevision(existing, e));
  };

  for (const e of ours.entries) take(e);
  for (const e of theirs.entries) take(e);

  for (const id of order) merged.entries.push(byId.get(id)!);
  merged.entries.push(...dedupeAnonymous(anonymous));
  return merged;
}

/** Rule 2: later `updated` wins; tie-break by lexicographically greater hash. */
function pickRevision(a: Entry, b: Entry): Entry {
  if (a.raw === b.raw) return a;
  const ua = a.meta.updated ?? '';
  const ub = b.meta.updated ?? '';
  if (ua !== ub) return ua > ub ? a : b;
  return hash(a.raw) > hash(b.raw) ? a : b;
}

function dedupeAnonymous(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of entries) {
    const h = hash(e.raw);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(e);
  }
  return out;
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

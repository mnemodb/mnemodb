/**
 * Deterministic merge of two versions of a document (spec §7.3).
 *
 * State-based CRDT semantics:
 *  1. Entry set = grow-only set keyed by id (union; distinct ids never conflict).
 *  2. Same id both sides → higher trust wins; at equal trust, later `updated`;
 *     tie → greater content hash.
 *  3. Supersession is monotonic (handled naturally by union of supersedes).
 *  4. Semantic contradictions are NOT resolved here — doctor flags them.
 *
 * Output is canonical (entries sorted by id, then anonymous by hash) so two
 * branches that each run the merge converge to byte-identical output.
 *
 * Note: day-to-day merging goes through git's union driver (mandatory
 * .gitattributes, spec §7.3); this implements the full semantics for a
 * dedicated merge driver and for engine-level reconciliation.
 */
import { createHash } from 'node:crypto';
import { trustRank } from './sanitize.js';
import type { Diagnostic, Entry, MemDoc } from './types.js';

export function mergeDocs(ours: MemDoc, theirs: MemDoc): MemDoc {
  const diagnostics: Diagnostic[] = [...ours.diagnostics];

  // Preamble / front matter: a state-based CRDT has no base version, so a true
  // 3-way text merge is out of scope (day-to-day this goes through git's union
  // driver). We pick deterministically (order-independent) and, when both sides
  // are non-empty and differ, emit a loud diagnostic rather than silently
  // dropping one (audit H4).
  const preamble = ours.preamble >= theirs.preamble ? ours.preamble : theirs.preamble;
  if (ours.preamble && theirs.preamble && ours.preamble !== theirs.preamble) {
    diagnostics.push({
      level: 'warn', line: 1, rule: 'preamble-diverged',
      message: 'Preambles differ on both sides; kept one deterministically — reconcile by hand if both matter.',
    });
  }
  const fmSide = (ours.frontMatterRaw ?? '') >= (theirs.frontMatterRaw ?? '') ? ours : theirs;
  if (ours.frontMatterRaw && theirs.frontMatterRaw && ours.frontMatterRaw !== theirs.frontMatterRaw) {
    diagnostics.push({
      level: 'warn', line: 1, rule: 'front-matter-diverged',
      message: 'Front matter differs on both sides; kept one deterministically — reconcile by hand if both matter.',
    });
  }

  const merged: MemDoc = {
    frontMatter: fmSide.frontMatter,
    frontMatterRaw: fmSide.frontMatterRaw,
    preamble,
    entries: [],
    diagnostics,
    path: ours.path,
  };

  const byId = new Map<string, Entry>();
  const anonymous: Entry[] = [];

  const take = (e: Entry) => {
    const id = e.meta.id;
    if (!id) { anonymous.push(e); return; }
    const existing = byId.get(id);
    byId.set(id, existing ? pickRevision(existing, e) : e);
  };

  for (const e of ours.entries) take(e);
  for (const e of theirs.entries) take(e);

  // Canonical order: id'd entries sorted by id, then deduped anonymous entries
  // ordered by content hash. Independent of argument order → byte-convergence
  // (audit M5). Each entry's raw is newline-terminated so concatenation cannot
  // glue the next heading onto this entry's last line (audit C1).
  for (const id of [...byId.keys()].sort()) merged.entries.push(withTrailingNewline(byId.get(id)!));
  for (const e of dedupeAnonymous(anonymous)) merged.entries.push(withTrailingNewline(e));
  return merged;
}

/**
 * Same-id revision winner. Higher trust ALWAYS wins — a lower-trust copy of an
 * entry can never override a higher-trust one (spec §10 invariant, audit H4).
 * Only at equal trust do we fall back to later `updated`, then greater hash.
 */
function pickRevision(a: Entry, b: Entry): Entry {
  if (a.raw === b.raw) return a;
  const ta = trustRank(a.meta.src);
  const tb = trustRank(b.meta.src);
  if (ta !== tb) return ta > tb ? a : b;
  const ua = a.meta.updated ?? '';
  const ub = b.meta.updated ?? '';
  if (ua !== ub) return ua > ub ? a : b;
  return hash(a.raw) > hash(b.raw) ? a : b;
}

/** Ensure raw ends with a newline so entry concatenation can't glue headings. */
function withTrailingNewline(e: Entry): Entry {
  if (!e.raw || e.raw.endsWith('\n')) return e;
  return { ...e, raw: e.raw + '\n' };
}

/** Dedupe anonymous (id-less) entries by content hash, ordered deterministically. */
function dedupeAnonymous(entries: Entry[]): Entry[] {
  const byHash = new Map<string, Entry>();
  for (const e of entries) {
    const h = hash(e.raw);
    if (!byHash.has(h)) byHash.set(h, e);
  }
  return [...byHash.keys()].sort().map((h) => byHash.get(h)!);
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

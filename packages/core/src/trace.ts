/**
 * Blast-radius trace: every entry a given provenance wrote.
 *
 * Provenance is recorded on every entry, but on its own it is a static label.
 * This turns it into an answer to the question that matters after something
 * goes wrong — "one tool/agent session turned out to be compromised, what did
 * it put in my memory?" — which a provenance-free memory folder cannot answer
 * at all.
 *
 * Matching is hierarchical: a query of `tool` matches `tool` and every
 * `tool/<session>` under it, while `tool/session-abc` matches only that
 * session. Comparison is NFC-normalized and case-insensitive, mirroring
 * `canonicalSrc`, so a non-canonical `Tool/Session-ABC` cannot hide from a
 * trace the way it once tried to hide from the trust check (audit H2).
 */
import { canonicalSrc } from './sanitize.js';
import { supersededIds } from './store.js';
import { isExpired } from './lifecycle.js';
import type { Store } from './store.js';

export interface TraceHit {
  id: string | null;
  type: string;
  statement: string;
  src: string;
  owner?: string;
  file: string;
  line: number;
  /** Still resolving into the live set (not superseded, not expired). */
  live: boolean;
  /** Tool-derived, i.e. content that must never be treated as instructions. */
  untrusted: boolean;
}

export interface TraceReport {
  query: string;
  matched: number;
  live: number;
  hits: TraceHit[];
}

/** True when an entry's `src` falls under the queried source. */
export function srcMatches(entrySrc: string | undefined, query: string): boolean {
  const e = (entrySrc ?? 'agent').normalize('NFC').trim().toLowerCase();
  const q = query.normalize('NFC').trim().toLowerCase();
  if (!q) return false;
  return e === q || e.startsWith(`${q}/`);
}

/** Every entry written by `query`, newest-file-order, with live/trust flags. */
export function traceSource(store: Store, query: string, now: Date = new Date()): TraceReport {
  const dead = supersededIds(store);
  const hits: TraceHit[] = [];
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      if (!srcMatches(e.meta.src, query)) continue;
      const live = !(e.meta.id && dead.has(e.meta.id)) && !isExpired(e, now);
      hits.push({
        id: e.meta.id ?? null,
        type: e.type,
        statement: e.statement,
        src: e.meta.src ?? 'agent',
        ...(e.meta.owner ? { owner: e.meta.owner } : {}),
        file: doc.path ?? '',
        line: e.line,
        live,
        untrusted: canonicalSrc(e.meta.src) === 'tool',
      });
    }
  }
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { query, matched: hits.length, live: hits.filter((h) => h.live).length, hits };
}

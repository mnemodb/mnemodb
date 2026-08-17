/**
 * Store validation — the engine behind `mnemo doctor` (spec §8, §11).
 * Detects: parse damage, duplicate/missing ids, orphan supersedes, conflict
 * markers, expired/stale entries, always-tier budget overruns, invalid ttl.
 */
import { REGISTERED_TYPES } from './types.js';
import { ttlDays, isExpired, isStale, hasAnchor } from './lifecycle.js';
import { alwaysTier, supersededIds, forgedSupersedes } from './store.js';
import type { Store } from './store.js';
import type { Diagnostic } from './types.js';

const CONFLICT_RE = /^(<{7}|={7}|>{7})/m;
const REGISTERED = new Set<string>(REGISTERED_TYPES);

export interface DoctorReport {
  diagnostics: Diagnostic[];
  stats: {
    files: number;
    entries: number;
    live: number;
    expired: number;
    stale: number;
    alwaysTierTokens: number;
    budget: number | null;
  };
}

/** Rough token estimate: chars/4 — good enough for budget warnings. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function doctor(store: Store, now: Date = new Date()): DoctorReport {
  const diagnostics: Diagnostic[] = [];
  const seenIds = new Map<string, string>();
  let entries = 0;
  let expired = 0;
  let stale = 0;

  for (const doc of store.docs) {
    const file = doc.path ?? '';
    const at = (line: number, level: 'error' | 'warn', rule: string, message: string) =>
      diagnostics.push({ level, line, rule, message: `${file}: ${message}` });

    // Parse-time diagnostics carry through.
    for (const d of doc.diagnostics) {
      diagnostics.push({ ...d, message: `${file}: ${d.message}` });
    }

    if (CONFLICT_RE.test(doc.preamble)) {
      at(1, 'error', 'conflict-marker', 'merge conflict markers in preamble');
    }

    for (const e of doc.entries) {
      entries++;
      if (e.malformed) at(e.line, 'error', 'malformed-entry', `degraded entry (${e.malformed}): ${e.statement.slice(0, 40)}`);
      if (CONFLICT_RE.test(e.raw)) at(e.line, 'error', 'conflict-marker', `merge conflict markers in entry ${e.meta.id ?? '(no id)'}`);
      if (!e.meta.id && !e.malformed) at(e.line, 'warn', 'missing-id', `entry has no id: ${e.statement.slice(0, 40)}`);
      if (e.meta.id) {
        const prior = seenIds.get(e.meta.id);
        if (prior) at(e.line, 'error', 'duplicate-id', `id '${e.meta.id}' already used in ${prior}`);
        else seenIds.set(e.meta.id, `${file}:${e.line}`);
      }
      if (!REGISTERED.has(e.type)) at(e.line, 'warn', 'unknown-type', `unknown entry type '${e.type}' (preserved)`);
      if (e.meta.ttl && e.meta.ttl !== 'none' && ttlDays(e.meta.ttl, e.type) === null) {
        at(e.line, 'warn', 'invalid-ttl', `invalid ttl '${e.meta.ttl}'`);
      }
      if (e.meta.ttl && e.meta.ttl !== 'none' && ttlDays(e.meta.ttl, e.type) !== null && !hasAnchor(e)) {
        at(e.line, 'warn', 'ttl-no-anchor', `entry ${e.meta.id ?? ''} has a ttl but no date anchor (updated/src) — it will never expire`);
      }
      if (isExpired(e, now)) { expired++; at(e.line, 'warn', 'expired', `entry ${e.meta.id ?? ''} past ttl — compaction will archive it`); }
      else if (isStale(e, now)) { stale++; at(e.line, 'warn', 'stale', `entry ${e.meta.id ?? ''} past review date — re-verify before relying on it`); }
    }
  }

  // Orphan supersedes: referenced id not found anywhere (including archive).
  const allIds = new Set(seenIds.keys());
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      for (const target of e.meta.supersedes ?? []) {
        if (!allIds.has(target)) {
          diagnostics.push({
            level: 'warn', line: e.line, rule: 'orphan-supersedes',
            message: `${doc.path}: entry ${e.meta.id ?? ''} supersedes unknown id '${target}'`,
          });
        }
      }
    }
  }

  // Contradiction candidates: two live entries superseding the same id (§7.3 rule 4).
  const supersederByTarget = new Map<string, string[]>();
  const dead = supersededIds(store);
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      if (e.meta.id && dead.has(e.meta.id)) continue;
      for (const target of e.meta.supersedes ?? []) {
        supersederByTarget.set(target, [...(supersederByTarget.get(target) ?? []), e.meta.id ?? '?']);
      }
    }
  }
  for (const [target, ids] of supersederByTarget) {
    if (ids.length > 1) {
      diagnostics.push({
        level: 'error', line: 0, rule: 'contradiction',
        message: `entries [${ids.join(', ')}] both supersede '${target}' — resolve by superseding one of them`,
      });
    }
  }

  // Forged supersedes: a lower-trust entry tried to hide a higher-trust one.
  for (const { by, target } of forgedSupersedes(store)) {
    diagnostics.push({
      level: 'error', line: 0, rule: 'forged-supersede',
      message: `entry ${by} tried to supersede higher-trust entry '${target}' — refused; target stays live`,
    });
  }

  // Budget check: always-tier tokens + preambles vs front-matter budget.
  const always = alwaysTier(store, now);
  let alwaysTierTokens = 0;
  for (const l of always) alwaysTierTokens += estimateTokens(l.entry.raw);
  for (const doc of store.docs) alwaysTierTokens += estimateTokens(doc.preamble);
  const budget = store.docs.reduce<number | null>(
    (acc, d) => (d.frontMatter?.budget ? (acc ?? 0) + d.frontMatter.budget : acc), null);
  if (budget !== null && alwaysTierTokens > budget) {
    diagnostics.push({
      level: 'warn', line: 0, rule: 'budget-overrun',
      message: `always-loaded tier ≈${alwaysTierTokens} tokens exceeds store budget ${budget}`,
    });
  }

  // Count live precisely (neither superseded nor expired). The old
  // `entries - expired - dead.size` double-subtracted entries that were both,
  // and counted orphan superseded ids that have no entry (audit L4).
  let live = 0;
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      if (e.meta.id && dead.has(e.meta.id)) continue;
      if (isExpired(e, now)) continue;
      live++;
    }
  }
  return {
    diagnostics,
    stats: {
      files: store.docs.length, entries, live: Math.max(live, 0),
      expired, stale, alwaysTierTokens, budget,
    },
  };
}

/** Lifecycle: TTL, review, expiry (spec §8). */
import { DEFAULT_TTL_DAYS } from './types.js';
import type { Entry } from './types.js';

const DUR_RE = /^(\d+)([dwmy])$/;
const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

/** Parse a duration like '90d', '6m', '1y' to days; null for 'none'/absent/invalid. */
export function ttlDays(ttl: string | undefined, type: string): number | null {
  if (ttl === 'none') return null;
  if (ttl) {
    const m = DUR_RE.exec(ttl);
    if (m) return Number(m[1]) * UNIT_DAYS[m[2]];
    return null; // invalid ttl: fail open (doctor flags it)
  }
  return DEFAULT_TTL_DAYS[type] ?? null;
}

function anchorDate(entry: Entry): Date | null {
  const src = entry.meta.updated;
  if (!src) {
    // Fall back to a date embedded in src provenance like 'agent/2026-08-10'.
    const m = /(\d{4}-\d{2}-\d{2})/.exec(entry.meta.src ?? '');
    if (m) return new Date(m[1]);
    return null;
  }
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whether an entry has a usable date anchor (updated, or a date in src). An
 *  entry with a ttl but no anchor can never expire — doctor flags that. */
export function hasAnchor(entry: Entry): boolean {
  return anchorDate(entry) !== null;
}

/** Expired: past ttl measured from `updated` (spec §8). Unknown anchor → not expired. */
export function isExpired(entry: Entry, now: Date = new Date()): boolean {
  const days = ttlDays(entry.meta.ttl, entry.type);
  if (days === null) return false;
  const anchor = anchorDate(entry);
  if (!anchor) return false;
  const ageDays = (now.getTime() - anchor.getTime()) / 86_400_000;
  return ageDays > days;
}

/** Stale: past its `review` date — served but flagged (spec §8). */
export function isStale(entry: Entry, now: Date = new Date()): boolean {
  if (!entry.meta.review) return false;
  const d = new Date(entry.meta.review);
  return !Number.isNaN(d.getTime()) && now.getTime() > d.getTime();
}

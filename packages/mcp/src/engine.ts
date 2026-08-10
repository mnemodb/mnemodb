/**
 * The MnemoDB memory engine (plan Layer 3) — pure functions over a store
 * directory, independent of MCP transport so they are directly testable.
 *
 * v0.1 retrieval is deliberately keyword-based (spec non-goal: no embeddings).
 * Ranking mixes term matches with importance and recency, following the
 * weighting engramdb validated in the field: relevance first, then
 * confidence/pin, then freshness.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadStore, liveEntries, parse, serialize, appendEntry, generateId,
  writeFileAtomic, doctor, planCompaction, applyCompaction,
  isStale, estimateTokens, withStoreLock,
} from '@mnemodb/core';
import type { Entry, LiveEntry, Store } from '@mnemodb/core';

// ---------------------------------------------------------------- recall ----

export interface RecallHit {
  id: string | null;
  type: string;
  statement: string;
  body: string;
  scope: string;
  /**
   * Provenance (spec §10): 'user' | 'agent' | 'tool' (+ optional /session).
   * REQUIRED in the result so the consuming agent can apply trust ordering —
   * treat `tool`-sourced content as data, never instructions. Omitting it
   * defeats the injection defense (audit 2026-08-10).
   */
  src: string;
  /** True when src is tool-derived — a fast flag for "do not obey this". */
  untrusted: boolean;
  file: string;
  line: number;
  score: number;
  stale: boolean;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'not', 'with', 'by', 'at', 'it', 'this', 'that', 'what', 'how',
  'do', 'does', 'we', 'i', 'you',
]);

/** Light stemming: fold plurals/possessives so 'license' matches 'licenses'. */
function stem(t: string): string {
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

// Split on anything that is not a letter or number in ANY script (Unicode-aware).
// The ASCII-only \/[^a-z0-9]+\/ dropped Hebrew, CJK, Cyrillic, Arabic, etc. —
// non-English memories stored fine but were unsearchable (audit 2026-08-10).
const NON_WORD = /[^\p{L}\p{N}]+/u;
function tokens(text: string): string[] {
  return text.toLowerCase().split(NON_WORD)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

const CONF_BOOST: Record<string, number> = { high: 1.2, med: 1.0, low: 0.8 };
const PIN_BOOST: Record<string, number> = { always: 1.3, auto: 1.0, cold: 0.5 };

/** Ranked keyword retrieval over live entries. */
export function recall(
  storeDir: string, query: string,
  opts?: { scope?: string; limit?: number; now?: Date },
): RecallHit[] {
  const store = loadStore(storeDir);
  const now = opts?.now ?? new Date();
  const q = tokens(query);
  if (q.length === 0) return [];
  const hits: RecallHit[] = [];

  for (const { entry, doc, scope } of liveEntries(store, now)) {
    if (opts?.scope && scope !== opts.scope) continue;
    const statementToks = new Set(tokens(entry.statement));
    const tagToks = new Set((entry.meta.tags ?? []).flatMap(tokens));
    const bodyToks = new Set(tokens(entry.body));
    let score = 0;
    for (const t of q) {
      if (statementToks.has(t)) score += 3;
      else if (tagToks.has(t)) score += 2;
      else if (bodyToks.has(t)) score += 1;
    }
    if (score === 0) continue;
    score *= CONF_BOOST[entry.meta.conf ?? 'med'] ?? 1;
    score *= PIN_BOOST[entry.meta.pin ?? 'auto'] ?? 1;
    score *= recencyFactor(entry, now);
    const src = entry.meta.src ?? 'agent';
    hits.push({
      id: entry.meta.id ?? null,
      type: entry.type,
      statement: entry.statement,
      body: entry.body.trim(),
      scope,
      src,
      untrusted: src.startsWith('tool'),
      file: doc.path ?? '',
      line: entry.line,
      score: Math.round(score * 100) / 100,
      stale: isStale(entry, now),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts?.limit ?? 8);
}

function recencyFactor(entry: Entry, now: Date): number {
  const src = entry.meta.updated ?? /(\d{4}-\d{2}-\d{2})/.exec(entry.meta.src ?? '')?.[1];
  if (!src) return 1;
  const d = new Date(src);
  if (Number.isNaN(d.getTime())) return 1;
  const ageDays = Math.max(0, (now.getTime() - d.getTime()) / 86_400_000);
  return 1 + 0.15 * Math.exp(-ageDays / 90); // mild freshness boost, decays over ~3 months
}

// -------------------------------------------------------------- remember ----

export interface RememberInput {
  statement: string;
  type?: string;
  body?: string;
  scope?: 'project' | 'user';
  tags?: string[];
  supersedes?: string[];
  /** Provenance; engine enforces truthful recording (spec §10.1). */
  src?: string;
  now?: Date;
}

export interface RememberResult {
  status: 'created' | 'duplicate' | 'superseded-and-created';
  id: string;
  file: string;
  duplicateOf?: string;
}

/** Jaccard similarity on token sets — cheap near-duplicate detection. */
function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function remember(storeDir: string, input: RememberInput): RememberResult {
  // Serialize writers: concurrent unlocked writers lose updates (audit 2026-08-10).
  const probeRoot = loadStore(storeDir).root;
  return withStoreLock(probeRoot, () => rememberLocked(storeDir, input));
}

function rememberLocked(storeDir: string, input: RememberInput): RememberResult {
  const store = loadStore(storeDir);
  const now = input.now ?? new Date();
  const scope = input.scope ?? 'project';

  // Dedup: near-identical live statement → return existing, write nothing.
  if (!input.supersedes?.length) {
    for (const { entry } of liveEntries(store, now)) {
      if (entry.meta.id && similarity(entry.statement, input.statement) >= 0.8) {
        return {
          status: 'duplicate', id: entry.meta.id, duplicateOf: entry.meta.id,
          file: '',
        };
      }
    }
  }

  const fileName = scope === 'user' ? 'user.mem.md' : 'project.mem.md';
  const path = join(store.root, fileName);
  const source = existsSync(path)
    ? readFileSync(path, 'utf8')
    : `---\nmnemo: "0.1"\nscope: ${scope}\ntitle: "${scope} memory"\nupdated: ${now.toISOString().slice(0, 10)}\n---\n`;
  const doc = parse(source, fileName);

  const used = new Set<string>();
  for (const d of store.docs) for (const e of d.entries) if (e.meta.id) used.add(e.meta.id);
  const id = generateId(used);

  appendEntry(doc, {
    type: input.type ?? 'note',
    statement: input.statement,
    meta: {
      id,
      scope: doc.frontMatter?.scope === scope ? undefined : scope,
      src: input.src ?? 'agent',
      updated: now.toISOString().slice(0, 10),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.supersedes?.length ? { supersedes: input.supersedes } : {}),
    },
    body: input.body ? (input.body.endsWith('\n') ? input.body : input.body + '\n') : '',
    raw: '', line: 0,
  });
  writeFileAtomic(path, serialize(doc));
  return {
    status: input.supersedes?.length ? 'superseded-and-created' : 'created',
    id, file: fileName,
  };
}

// ---------------------------------------------------------------- review ----

export interface ReviewReport {
  stale: { id: string | null; statement: string; review?: string }[];
  contradictions: string[];
  errors: string[];
  expiredCount: number;
  alwaysTierTokens: number;
  budget: number | null;
}

export function review(storeDir: string, now: Date = new Date()): ReviewReport {
  const store = loadStore(storeDir);
  const report = doctor(store, now);
  const staleEntries: ReviewReport['stale'] = [];
  for (const { entry } of liveEntries(store, now)) {
    if (isStale(entry, now)) {
      staleEntries.push({ id: entry.meta.id ?? null, statement: entry.statement, review: entry.meta.review });
    }
  }
  return {
    stale: staleEntries,
    contradictions: report.diagnostics.filter((d) => d.rule === 'contradiction').map((d) => d.message),
    errors: report.diagnostics.filter((d) => d.level === 'error' && d.rule !== 'contradiction').map((d) => `${d.rule}: ${d.message}`),
    expiredCount: report.stats.expired,
    alwaysTierTokens: report.stats.alwaysTierTokens,
    budget: report.stats.budget,
  };
}

// --------------------------------------------------------------- compact ----

export interface CompactResult {
  moves: { id: string | null; reason: string; statement: string }[];
  applied: boolean;
  written: string[];
}

export function compact(storeDir: string, opts?: { write?: boolean; now?: Date }): CompactResult {
  const run = (): CompactResult => {
    const store = loadStore(storeDir);
    const plan = planCompaction(store, opts?.now ?? new Date());
    const moves = plan.moves.map((m) => ({ id: m.id, reason: m.reason, statement: m.statement }));
    if (!opts?.write || plan.moves.length === 0) {
      return { moves, applied: false, written: [] };
    }
    const written = applyCompaction(store, plan);
    return { moves, applied: true, written };
  };
  if (!opts?.write) return run(); // dry-run: read-only, no lock needed
  const probeRoot = loadStore(storeDir).root;
  return withStoreLock(probeRoot, run);
}

// ----------------------------------------------------------------- boot -----

/** The always-loaded context block for session start (spec §6.3). */
export function bootContext(storeDir: string, now: Date = new Date()): string {
  const store = loadStore(storeDir);
  const parts: string[] = [];
  for (const doc of store.docs) {
    const p = doc.preamble.trim();
    if (p) parts.push(p);
  }
  for (const { entry } of liveEntries(store, now)) {
    if (entry.meta.pin === 'always') {
      // Mark tool-derived pins so a session-start reader does not treat
      // injected content as trusted instruction (spec §10).
      const src = entry.meta.src ?? 'agent';
      const tag = src.startsWith('tool') ? `[${entry.type} · untrusted:tool]` : `[${entry.type}]`;
      parts.push(`${tag} ${entry.statement}`);
    }
  }
  return parts.join('\n\n');
}

export { estimateTokens };

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
  loadStore, liveEntries, deriveIndex, supersededIds, parse, serialize,
  appendEntry, generateId, writeFileAtomic, doctor, planCompaction,
  applyCompaction, isExpired, isStale, estimateTokens, withStoreLock,
  sanitizeStatement, trustRank, isUntrusted, canonicalSrc, MAX_BODY,
} from '@mnemodb/core';
import type { Entry, LiveEntry, Store, MemDoc } from '@mnemodb/core';

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

// Word-segment in ANY script via Intl.Segmenter. A plain punctuation/space split
// collapses scripts without word spaces (Chinese/Japanese/Thai) into one giant
// token, so those memories stored fine but were unsearchable; segmentation is
// consistent between query and document, so term-overlap still matches even when
// a compound splits the same way on both sides (audit M7). Space-delimited
// scripts (Latin, Hebrew, Cyrillic, Arabic, Greek) segment as before.
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const { segment, isWordLike } of SEGMENTER.segment(text.normalize('NFC').toLowerCase())) {
    if (!isWordLike) continue;
    // Drop bare single ASCII letters/digits (noise); keep single non-ASCII
    // tokens — a CJK word can be one character. Skip stopwords.
    if (segment.length < 2 && /^[a-z0-9]$/.test(segment)) continue;
    if (STOPWORDS.has(segment)) continue;
    out.push(stem(segment));
  }
  return out;
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
  const q = [...new Set(tokens(query))]; // dedupe so repeated terms can't inflate score
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
      untrusted: isUntrusted(src),
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

// ------------------------------------------------------------------ list ----

export interface ListItem {
  id: string | null;
  type: string;
  statement: string;
  scope: string;
  pin: string;
  src: string;
  tags: string[];
  live: boolean;
  untrusted: boolean;
}

/**
 * Browse the whole store: the derived index (headings + metadata, no bodies),
 * with a live flag. This is the in-agent equivalent of `mnemo list` — use it to
 * see everything the store holds, not just what matches a query.
 */
export function list(
  storeDir: string,
  opts?: { scope?: string; type?: string; includeArchived?: boolean; now?: Date },
): ListItem[] {
  const store = loadStore(storeDir);
  const now = opts?.now ?? new Date();
  const dead = supersededIds(store);
  const srcById = new Map<string, string>();
  for (const doc of store.docs) {
    for (const e of doc.entries) if (e.meta.id) srcById.set(e.meta.id, e.meta.src ?? 'agent');
  }
  const items: ListItem[] = [];
  for (const doc of store.docs) {
    const fileScope = doc.frontMatter?.scope ?? 'project';
    for (const e of doc.entries) {
      const scope = e.meta.scope ?? fileScope;
      if (opts?.scope && scope !== opts.scope) continue;
      if (opts?.type && e.type !== opts.type) continue;
      const superseded = e.meta.id ? dead.has(e.meta.id) : false;
      const expired = isExpired(e, now);
      const live = !superseded && !expired;
      if (!live && !opts?.includeArchived) continue;
      const src = e.meta.src ?? 'agent';
      items.push({
        id: e.meta.id ?? null,
        type: e.type,
        statement: e.statement,
        scope,
        pin: e.meta.pin ?? 'auto',
        src,
        tags: e.meta.tags ?? [],
        live,
        untrusted: isUntrusted(src),
      });
    }
  }
  return items;
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
  const scope: 'project' | 'user' = input.scope === 'user' ? 'user' : 'project';

  // Size caps (audit 2026-08-10): reject before doing any work.
  const statement = sanitizeStatement(input.statement ?? '');
  if (!statement) throw new Error('memory_remember: statement is empty after sanitization');
  if ((input.body ?? '').length > MAX_BODY) throw new Error(`memory_remember: body exceeds ${MAX_BODY} chars`);
  // `src` is fixed to 'agent' at the MCP boundary; programmatic callers may pass
  // a value but it is cleaned and can never be a raw 'user' spoof via injection.
  const src = (input.src ?? 'agent');
  // Only same-or-higher-trust writers may supersede (mirrors §10; a tool/agent
  // caller cannot erase a user entry — enforced again at resolution).
  const supersedes = (input.supersedes ?? []).filter((tid) => {
    const target = store.docs.flatMap((d) => d.entries).find((e) => e.meta.id === tid);
    if (!target) return true;
    // Only bar the tool→(user/agent) escalation; agent/user may revise freely.
    return !(trustRank(src) === 1 && trustRank(target.meta.src) > 1);
  });

  // Dedup: near-identical live statement → return existing, write nothing.
  if (!supersedes.length) {
    for (const { entry } of liveEntries(store, now)) {
      if (entry.meta.id && similarity(entry.statement, statement) >= 0.8) {
        const dupFile = store.docs.find((d) => d.entries.some((x) => x.meta.id === entry.meta.id))?.path ?? '';
        return { status: 'duplicate', id: entry.meta.id, duplicateOf: entry.meta.id, file: dupFile };
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
  const entriesBefore = doc.entries.length;

  appendEntry(doc, {
    type: input.type ?? 'note',
    statement,
    meta: {
      id,
      scope: doc.frontMatter?.scope === scope ? undefined : scope,
      src,
      updated: now.toISOString().slice(0, 10),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(supersedes.length ? { supersedes } : {}),
    },
    body: input.body ?? '',
    raw: '', line: 0,
  });
  const output = serialize(doc);

  // Fail-closed integrity backstop: the write must add EXACTLY one entry with
  // our id. If sanitization ever misses a vector, refuse rather than persist an
  // injected store (audit 2026-08-10).
  const reparsed = parse(output);
  const mine = reparsed.entries.filter((e) => e.meta.id === id);
  if (reparsed.entries.length !== entriesBefore + 1 || mine.length !== 1) {
    throw new Error('memory_remember: refused — content would alter store structure');
  }

  writeFileAtomic(path, output);
  return {
    status: supersedes.length ? 'superseded-and-created' : 'created',
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
      const tag = isUntrusted(src) ? `[${entry.type} · untrusted:tool]` : `[${entry.type}]`;
      parts.push(`${tag} ${entry.statement}`);
    }
  }
  return parts.join('\n\n');
}

// ------------------------------------------------------------------ show ----

export interface ShowResult {
  id: string;
  type: string;
  statement: string;
  body: string;
  scope: string;
  src: string;
  untrusted: boolean;
  conf?: string;
  pin: string;
  tags: string[];
  updated?: string;
  ttl?: string;
  review?: string;
  live: boolean;
  status: 'live' | 'superseded' | 'expired';
  file: string;
  line: number;
}

function findEntry(store: Store, id: string): { entry: Entry; doc: MemDoc } | null {
  for (const doc of store.docs) {
    for (const entry of doc.entries) if (entry.meta.id === id) return { entry, doc };
  }
  return null;
}

/** Full detail for one entry, including body and lifecycle status. */
export function show(storeDir: string, id: string, now: Date = new Date()): ShowResult | null {
  const store = loadStore(storeDir);
  const found = findEntry(store, id);
  if (!found) return null;
  const { entry, doc } = found;
  const dead = supersededIds(store);
  const superseded = entry.meta.id ? dead.has(entry.meta.id) : false;
  const expired = isExpired(entry, now);
  const src = entry.meta.src ?? 'agent';
  return {
    id, type: entry.type, statement: entry.statement, body: entry.body.trim(),
    scope: entry.meta.scope ?? doc.frontMatter?.scope ?? 'project',
    src, untrusted: isUntrusted(src),
    conf: entry.meta.conf, pin: entry.meta.pin ?? 'auto', tags: entry.meta.tags ?? [],
    updated: entry.meta.updated, ttl: entry.meta.ttl, review: entry.meta.review,
    live: !superseded && !expired,
    status: superseded ? 'superseded' : expired ? 'expired' : 'live',
    file: doc.path ?? '', line: entry.line,
  };
}

// --------------------------------------------------------------- history ----

export interface HistoryNode { id: string | null; statement: string; src: string; updated?: string }
export interface HistoryResult {
  id: string;
  /** Entries this one replaced (older → this), most recent first. */
  supersedes: HistoryNode[];
  /** Entries that replaced this one (this → newer). */
  supersededBy: HistoryNode[];
}

/** The supersession lineage of an entry — what it replaced and what replaced it. */
export function history(storeDir: string, id: string): HistoryResult | null {
  const store = loadStore(storeDir);
  const all = store.docs.flatMap((d) => d.entries);
  const byId = new Map(all.filter((e) => e.meta.id).map((e) => [e.meta.id!, e]));
  if (!byId.has(id)) return null;
  const node = (e: Entry): HistoryNode => ({
    id: e.meta.id ?? null, statement: e.statement, src: e.meta.src ?? 'agent', updated: e.meta.updated,
  });
  // Walk ALL superseded predecessors (an entry may replace more than one),
  // not just the first, so the lineage is complete (audit LOW).
  const supersedes: HistoryNode[] = [];
  const seen = new Set<string>([id]);
  const queue = [...(byId.get(id)!.meta.supersedes ?? [])];
  while (queue.length) {
    const prevId = queue.shift()!;
    if (seen.has(prevId)) continue;
    seen.add(prevId);
    const prev = byId.get(prevId);
    if (!prev) continue;
    supersedes.push(node(prev));
    queue.push(...(prev.meta.supersedes ?? []));
  }
  const supersededBy = all
    .filter((e) => (e.meta.supersedes ?? []).includes(id))
    .map(node);
  return { id, supersedes, supersededBy };
}

// ----------------------------------------------------------------- stats ----

export interface StatsResult {
  total: number;
  live: number;
  archived: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  byProvenance: Record<string, number>;
  pinnedAlways: number;
  stale: number;
  alwaysTierTokens: number;
  budget: number | null;
}

/** A self-report of the store: counts, provenance mix, budget load, staleness. */
export function stats(storeDir: string, now: Date = new Date()): StatsResult {
  const store = loadStore(storeDir);
  const dead = supersededIds(store);
  const rep = doctor(store, now);
  const byType: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  const byProvenance: Record<string, number> = {};
  let total = 0, live = 0, pinnedAlways = 0, stale = 0;
  for (const doc of store.docs) {
    const fileScope = doc.frontMatter?.scope ?? 'project';
    for (const e of doc.entries) {
      total++;
      const isLive = !(e.meta.id && dead.has(e.meta.id)) && !isExpired(e, now);
      if (isLive) live++;
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      const scope = e.meta.scope ?? fileScope;
      byScope[scope] = (byScope[scope] ?? 0) + 1;
      const src = canonicalSrc(e.meta.src);
      byProvenance[src] = (byProvenance[src] ?? 0) + 1;
      if (isLive && e.meta.pin === 'always') pinnedAlways++;
      if (isLive && isStale(e, now)) stale++;
    }
  }
  return {
    total, live, archived: total - live, byType, byScope, byProvenance,
    pinnedAlways, stale, alwaysTierTokens: rep.stats.alwaysTierTokens, budget: rep.stats.budget,
  };
}

// ---------------------------------------------------------------- forget ----

export interface ForgetResult {
  status: 'forgotten' | 'not-found' | 'refused';
  id: string;
  reason?: string;
}

/**
 * Auditable soft-delete: move an entry to the archive (recoverable), rather than
 * hard-deleting. Trust-gated (spec §10): an agent/tool-initiated forget may not
 * remove a higher-trust (user) entry — so an injected "forget the security note"
 * instruction cannot erase what you told the agent.
 */
export function forget(
  storeDir: string, id: string, opts?: { by?: string; reason?: string; now?: Date },
): ForgetResult {
  const by = opts?.by ?? 'agent';
  const now = opts?.now ?? new Date();
  const probeRoot = loadStore(storeDir).root;
  return withStoreLock(probeRoot, (): ForgetResult => {
    const store = loadStore(storeDir);
    const found = findEntry(store, id);
    if (!found) return { status: 'not-found', id };
    // Trust gate (spec §10): a lower-trust caller cannot forget a user entry —
    // so an injected "forget the security note" cannot erase what the user said.
    if (trustRank(by) < trustRank(found.entry.meta.src)) {
      return { status: 'refused', id, reason: 'cannot forget a higher-trust entry' };
    }
    // Forget = supersede with a cold tombstone (MnemoDB never hard-deletes).
    // The target becomes superseded → not live → hidden, but fully recoverable.
    const tombstone: Entry = {
      type: 'note',
      statement: `forgotten: ${found.entry.statement}`.slice(0, 200),
      meta: {
        id: generateId(new Set(store.docs.flatMap((d) => d.entries).map((e) => e.meta.id!).filter(Boolean))),
        src: by, pin: 'cold', supersedes: [id], tags: ['forgotten'],
        updated: now.toISOString().slice(0, 10),
      },
      body: opts?.reason ? `Reason: ${opts.reason}\n` : '',
      raw: '', line: 0,
    };
    appendEntry(found.doc, tombstone);
    const output = serialize(found.doc);
    // Fail-closed backstop (mirrors remember): the tombstone must register and
    // the target must now be superseded. If a malformed body (e.g. an unclosed
    // code fence in a hand-edited/imported entry) swallowed the tombstone
    // heading, refuse rather than report a false 'forgotten' (audit H1).
    const reparsed = parse(output);
    const registered = reparsed.entries.some(
      (e) => e.meta.id === tombstone.meta.id && (e.meta.supersedes ?? []).includes(id),
    );
    if (!registered) {
      throw new Error('memory_forget: refused — store structure would hide the tombstone (unclosed code fence?)');
    }
    if (found.doc.path) writeFileAtomic(join(store.root, found.doc.path), output);
    return { status: 'forgotten', id, reason: opts?.reason };
  });
}

// ------------------------------------------------------------------ pin ------

export interface PinResult { status: 'pinned' | 'not-found' | 'refused'; id: string; pin?: string; reason?: string }

/**
 * Set an entry's load tier: always (session-start), auto (on-demand), cold
 * (search-only). Controls context budget — something a flat folder can't do.
 * Guard: a tool-sourced entry may NOT be pinned to `always` (that would inject
 * untrusted content into every session).
 */
export function pin(
  storeDir: string, id: string, level: 'always' | 'auto' | 'cold',
): PinResult {
  const probeRoot = loadStore(storeDir).root;
  return withStoreLock(probeRoot, (): PinResult => {
    const store = loadStore(storeDir);
    const found = findEntry(store, id);
    if (!found) return { status: 'not-found', id };
    if (level === 'always' && isUntrusted(found.entry.meta.src)) {
      return { status: 'refused', id, reason: 'cannot pin a tool-sourced entry to always' };
    }
    found.entry.meta.pin = level;
    found.entry.dirty = true;
    if (found.doc.path) writeFileAtomic(join(store.root, found.doc.path), serialize(found.doc));
    return { status: 'pinned', id, pin: level };
  });
}

export { estimateTokens };

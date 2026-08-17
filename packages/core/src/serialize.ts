/**
 * Serializer (spec §11 writer rules).
 *
 * Round-trip guarantee: for a document parsed and not modified,
 * serialize(parse(s)) === s, byte for byte — untouched blocks are emitted
 * from their preserved `raw` text. Entries marked `dirty` (or created
 * programmatically without `raw`) are regenerated from fields.
 */
import { randomInt } from 'node:crypto';
import type { Entry, MemDoc } from './types.js';
import { sanitizeStatement, sanitizeBody, sanitizeTags } from './sanitize.js';

export function serialize(doc: MemDoc): string {
  let out = doc.frontMatterRaw ?? '';
  out += doc.preamble;
  for (const entry of doc.entries) {
    out += entry.dirty || !entry.raw ? serializeEntry(entry) : entry.raw;
  }
  return out;
}

/**
 * Regenerate an entry block from its fields (canonical form).
 * Statement, body, and tags are sanitized here so that NO write path — engine,
 * CLI, importers, or third-party callers — can inject entry structure or
 * control characters into the store (audit 2026-08-10). Entries emitted from
 * preserved `raw` (untouched, parsed from disk) bypass this and stay
 * byte-stable; only regenerated (dirty/new) entries are sanitized.
 */
export function serializeEntry(entry: Entry): string {
  const type = /^[a-z][a-z0-9_-]*$/.test(entry.type) ? entry.type : 'note';
  const statement = sanitizeStatement(entry.statement);
  const heading = `## ${type}: ${statement}\n`;
  const safeEntry: Entry = { ...entry, meta: { ...entry.meta, tags: sanitizeTags(entry.meta.tags) } };
  const metaLine = formatMetaLine(safeEntry);
  const rawBody = entry.body.length > 0 ? sanitizeBody(entry.body) : '';
  const body = rawBody && !rawBody.endsWith('\n') ? rawBody + '\n' : rawBody;
  return heading + (metaLine ? metaLine + '\n' : '') + body;
}

// Metadata values may never contain the token separators `|` or backtick, or
// newlines — otherwise a crafted value forges extra fields (audit 2026-08-10).
const cleanVal = (v: string): string =>
  String(v).replace(/[`|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
const cleanId = (v: string): string => (/^[a-z0-9]{4,26}$/.test(v) ? v : '');

export function formatMetaLine(entry: Entry): string {
  const m = entry.meta;
  const id = m.id ? cleanId(m.id) : '';
  if (!id) return '';
  const tokens: string[] = [id];
  const push = (k: string, v: string | undefined) => { if (v) tokens.push(`${k}: ${cleanVal(v)}`); };
  push('scope', m.scope);
  push('src', m.src);
  push('conf', m.conf);
  push('pin', m.pin);
  push('ttl', m.ttl);
  push('review', m.review);
  push('updated', m.updated);
  const sup = (m.supersedes ?? []).map(cleanId).filter(Boolean);
  if (sup.length) tokens.push(`supersedes: ${sup.join(', ')}`);
  if (m.tags?.length) tokens.push(`tags: ${m.tags.map(cleanVal).filter(Boolean).join(', ')}`);
  for (const [k, v] of Object.entries(m.extra ?? {})) {
    if (/^[a-z][a-z0-9_-]*$/.test(k)) tokens.push(`${k}: ${cleanVal(v)}`);
  }
  return '`mnemo ' + tokens.join(' | ') + '`';
}

/** Generate a random entry id conforming to [a-z0-9]{4,26} (8 chars). */
export function generateId(existing?: Set<string>): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 8; i++) id += alphabet[randomInt(alphabet.length)];
    if (!existing?.has(id)) return id;
  }
}

/** Append an entry to a document, marking it for regeneration. */
export function appendEntry(doc: MemDoc, entry: Entry): void {
  const last = doc.entries.at(-1);
  if (last && last.raw && !last.raw.endsWith('\n')) {
    last.raw += '\n';
  }
  const needsGap =
    (last && !last.raw.endsWith('\n\n')) ||
    (!last && doc.preamble.length > 0 && !doc.preamble.endsWith('\n\n'));
  doc.entries.push({
    ...entry,
    raw: (needsGap ? '\n' : '') + serializeEntry(entry),
    dirty: false,
  });
}

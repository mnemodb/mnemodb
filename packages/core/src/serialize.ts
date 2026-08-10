/**
 * Serializer (spec §11 writer rules).
 *
 * Round-trip guarantee: for a document parsed and not modified,
 * serialize(parse(s)) === s, byte for byte — untouched blocks are emitted
 * from their preserved `raw` text. Entries marked `dirty` (or created
 * programmatically without `raw`) are regenerated from fields.
 */
import type { Entry, MemDoc } from './types.js';

export function serialize(doc: MemDoc): string {
  let out = doc.frontMatterRaw ?? '';
  out += doc.preamble;
  for (const entry of doc.entries) {
    out += entry.dirty || !entry.raw ? serializeEntry(entry) : entry.raw;
  }
  return out;
}

/** Regenerate an entry block from its fields (canonical form). */
export function serializeEntry(entry: Entry): string {
  const heading = `## ${entry.type}: ${entry.statement}\n`;
  const metaLine = formatMetaLine(entry);
  const body = entry.body.length > 0 ? entry.body : '';
  return heading + (metaLine ? metaLine + '\n' : '') + body;
}

export function formatMetaLine(entry: Entry): string {
  const m = entry.meta;
  if (!m.id) return '';
  const tokens: string[] = [m.id];
  const push = (k: string, v: string | undefined) => { if (v) tokens.push(`${k}: ${v}`); };
  push('scope', m.scope);
  push('src', m.src);
  push('conf', m.conf);
  push('pin', m.pin);
  push('ttl', m.ttl);
  push('review', m.review);
  push('updated', m.updated);
  if (m.supersedes?.length) tokens.push(`supersedes: ${m.supersedes.join(', ')}`);
  if (m.tags?.length) tokens.push(`tags: ${m.tags.join(', ')}`);
  for (const [k, v] of Object.entries(m.extra ?? {})) tokens.push(`${k}: ${v}`);
  return '`mnemo ' + tokens.join(' | ') + '`';
}

/** Generate a random entry id conforming to [a-z0-9]{4,26} (8 chars). */
export function generateId(existing?: Set<string>): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 8; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
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

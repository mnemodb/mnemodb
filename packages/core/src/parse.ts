/**
 * Parser for .mem.md documents (spec §3.3–§5).
 *
 * Error-tolerant by mandate (spec §11): malformed content degrades and is
 * reported, never dropped or rewritten. Byte-stable: every block keeps its
 * exact original text in `raw`, so serialize(parse(s)) === s for untouched
 * documents.
 */
import type { Diagnostic, Entry, EntryMeta, FrontMatter, MemDoc } from './types.js';

const HEADING_RE = /^## (?:([a-z][a-z0-9_-]*): )?(.*)$/;
const META_LINE_RE = /^`mnemo ([^`]*)`\s*$/;
const ID_RE = /^[a-z0-9]{4,26}$/;
const LIST_KEYS = new Set(['supersedes', 'tags']);
const KNOWN_KEYS = new Set([
  'scope', 'src', 'conf', 'pin', 'ttl', 'review', 'updated', 'supersedes', 'tags',
]);

/** Parse a complete .mem.md document. Never throws on content. */
export function parse(source: string, path?: string): MemDoc {
  const diagnostics: Diagnostic[] = [];
  let rest = source;
  let lineOffset = 0;

  // --- Front matter (spec §4): only at byte 0, delimited by --- lines.
  let frontMatterRaw: string | null = null;
  let frontMatter: FrontMatter | null = null;
  const fmOpen = rest.startsWith('---\n') ? 4 : rest.startsWith('---\r\n') ? 5 : 0;
  if (fmOpen > 0 || rest === '---') {
    const end = rest.indexOf('\n---', 3);
    const endLineBreak = end >= 0 ? rest.indexOf('\n', end + 1) : -1;
    if (end >= 0) {
      const rawEnd = endLineBreak >= 0 ? endLineBreak + 1 : rest.length;
      frontMatterRaw = rest.slice(0, rawEnd);
      const inner = rest.slice(fmOpen, end);
      frontMatter = parseFrontMatter(inner, diagnostics);
      rest = rest.slice(rawEnd);
      lineOffset = countLines(frontMatterRaw);
    } else {
      diagnostics.push({
        level: 'warn', line: 1, rule: 'front-matter-unterminated',
        message: 'Front matter opened with --- but never closed; treating file as untyped.',
      });
    }
  }

  // --- Split into preamble + entry blocks on '## ' headings at line start.
  const lines = rest.split('\n');
  const headingLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) headingLines.push(i);
  }

  const preamble = headingLines.length === 0
    ? rest
    : lines.slice(0, headingLines[0]).join('\n') + (headingLines[0] > 0 ? '\n' : '');

  const entries: Entry[] = [];
  for (let h = 0; h < headingLines.length; h++) {
    const start = headingLines[h];
    const end = h + 1 < headingLines.length ? headingLines[h + 1] : lines.length;
    const blockLines = lines.slice(start, end);
    // Preserve exact text: rejoin and keep trailing newline except at EOF.
    let raw = blockLines.join('\n');
    if (end < lines.length) raw += '\n';
    entries.push(parseEntry(blockLines, raw, lineOffset + start + 1, diagnostics));
  }

  return { frontMatter, frontMatterRaw, preamble, entries, diagnostics, path };
}

function parseEntry(
  blockLines: string[], raw: string, line: number, diagnostics: Diagnostic[],
): Entry {
  // CRLF tolerance (spec §11: degrade never, and Windows checkouts use \r\n):
  // strip a trailing \r before matching; raw text is preserved untouched.
  const heading = blockLines[0].endsWith('\r') ? blockLines[0].slice(0, -1) : blockLines[0];
  const m = HEADING_RE.exec(heading);
  // HEADING_RE always matches a '## ' line; type group may be absent (untyped).
  const type = m?.[1] ?? 'note';
  const statement = (m?.[1] ? m?.[2] : heading.slice(3)) ?? '';
  let malformed: string | undefined;

  // Metadata line: first non-blank line after the heading, if it is a mnemo span.
  let meta: EntryMeta = {};
  let metaLineIdx = -1;
  for (let i = 1; i < blockLines.length; i++) {
    const t = blockLines[i].trim();
    if (t === '') continue;
    const mm = META_LINE_RE.exec(t);
    if (mm) {
      metaLineIdx = i;
      const result = parseMetaTokens(mm[1], line + i, diagnostics);
      meta = result.meta;
      if (result.malformed) malformed = result.malformed;
    } else if (t.startsWith('`mnemo')) {
      // Looks like a metadata line but does not parse — degrade, keep verbatim.
      malformed = 'metadata line present but unparseable';
      diagnostics.push({
        level: 'error', line: line + i, rule: 'meta-unparseable',
        message: `Unparseable metadata line: ${t.slice(0, 60)}`,
      });
      metaLineIdx = i;
    }
    break; // only the first non-blank line is eligible
  }

  const bodyStart = metaLineIdx >= 0 ? metaLineIdx + 1 : 1;
  const body = blockLines.slice(bodyStart).join('\n');

  if (!m?.[1]) {
    diagnostics.push({
      level: 'warn', line, rule: 'untyped-entry',
      message: `Untyped entry treated as note: ${statement.slice(0, 50)}`,
    });
  }

  return { type, statement, meta, body, raw, line, ...(malformed ? { malformed } : {}) };
}

function parseMetaTokens(
  inner: string, line: number, diagnostics: Diagnostic[],
): { meta: EntryMeta; malformed?: string } {
  const meta: EntryMeta = {};
  let malformed: string | undefined;
  const tokens = inner.split(' | ');
  const idTok = tokens.shift()?.trim() ?? '';
  if (ID_RE.test(idTok)) {
    meta.id = idTok;
  } else {
    malformed = `invalid id '${idTok}'`;
    diagnostics.push({
      level: 'error', line, rule: 'bad-id',
      message: `Entry id '${idTok}' violates [a-z0-9]{4,26}.`,
    });
  }
  for (const tok of tokens) {
    const sep = tok.indexOf(': ');
    if (sep < 0) {
      diagnostics.push({
        level: 'error', line, rule: 'bad-meta-token',
        message: `Metadata token without ': ' separator: '${tok}'`,
      });
      malformed = malformed ?? `bad token '${tok}'`;
      continue;
    }
    const key = tok.slice(0, sep).trim();
    const value = tok.slice(sep + 2).trim();
    if (LIST_KEYS.has(key)) {
      (meta as Record<string, unknown>)[key] = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (KNOWN_KEYS.has(key)) {
      (meta as Record<string, unknown>)[key] = value;
    } else {
      (meta.extra ??= {})[key] = value; // unknown keys preserved (conformance)
    }
  }
  return { meta, ...(malformed ? { malformed } : {}) };
}

function parseFrontMatter(inner: string, diagnostics: Diagnostic[]): FrontMatter {
  // Minimal YAML subset: flat `key: value` lines. Sufficient for spec §4;
  // full YAML is deliberately out of scope for the zero-dependency core.
  const fm: FrontMatter = {};
  const knownFm = new Set(['mnemo', 'scope', 'title', 'updated', 'budget']);
  for (const [i, lineText] of inner.split('\n').entries()) {
    const t = lineText.trim();
    if (t === '' || t.startsWith('#')) continue;
    const sep = t.indexOf(':');
    if (sep < 0) {
      diagnostics.push({
        level: 'warn', line: i + 2, rule: 'front-matter-line',
        message: `Ignored front-matter line: ${t.slice(0, 50)}`,
      });
      continue;
    }
    const key = t.slice(0, sep).trim();
    let value = t.slice(sep + 1).trim();
    const comment = value.indexOf(' #');
    if (comment >= 0) value = value.slice(0, comment).trim();
    value = value.replace(/^"|"$/g, '');
    if (key === 'budget') fm.budget = Number(value) || undefined;
    else if (knownFm.has(key)) (fm as Record<string, unknown>)[key] = value;
    else (fm.extra ??= {})[key] = value;
  }
  return fm;
}

function countLines(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === '\n') n++;
  return n;
}

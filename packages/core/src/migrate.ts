/**
 * Migration importers (spec §9 and Appendix C).
 *
 * - migrateProseFile: wrap an existing CLAUDE.md/AGENTS.md as the preamble of
 *   a project.mem.md — the zero-loss, reversible on-ramp. The original file
 *   is never modified.
 * - importNumberedDir: import ADR-style numbered directories
 *   (adr/0001-slug.md, learning-records/0001-slug.md) as typed entries.
 *   'superseded by NNNN' status lines map to `supersedes` on the newer record.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { generateId } from './serialize.js';
import type { Entry } from './types.js';

export interface ImportedEntry extends Entry {
  sourceFile: string;
}

/** Front matter + prose preamble for a store file seeded from an existing memory file. */
export function migrateProseFile(
  sourcePath: string, opts?: { scope?: string; title?: string; today?: string },
): string {
  const content = readFileSync(sourcePath, 'utf8');
  const scope = opts?.scope ?? 'project';
  const title = opts?.title ?? `migrated from ${basename(sourcePath)}`;
  const date = opts?.today ?? new Date().toISOString().slice(0, 10);
  const fm = `---\nmnemo: "0.1"\nscope: ${scope}\ntitle: "${title}"\nupdated: ${date}\n---\n\n`;
  const body = content.endsWith('\n') ? content : content + '\n';
  return fm + body;
}

const MD_RE = /\.md$/i;
const MAX_STATEMENT = 160;

/**
 * Import a Claude Code native-memory directory
 * (~/.claude/projects/<project>/memory/) as typed entries.
 *
 * Native memory is slug-named topic files (`restmittel-cent-genau.md`,
 * `avd-run-workflow.md`, …) plus a `MEMORY.md` index — the corpus Claude Code
 * writes automatically. This brings that whole corpus into MnemoDB so a single
 * store can be canonical (the roadmap's "adapter for Claude's native memory").
 *
 * Each `.md` file becomes one entry: a short derived title is the statement,
 * the FULL file content is the body (lossless), and provenance is `src: agent`
 * because Claude authored these, not the user. `MEMORY.md` is imported too and
 * may overlap the topic files — review and prune with `mnemo compact`/`forget`.
 * Default type is `note`; retype entries as decisions/facts/prefs over time.
 */
export function importClaudeMemoryDir(
  dir: string, opts?: { type?: string; src?: string; today?: string },
): ImportedEntry[] {
  const type = opts?.type ?? 'note';
  const src = opts?.src ?? 'agent';
  const date = opts?.today ?? new Date().toISOString().slice(0, 10);
  const used = new Set<string>();
  const out: ImportedEntry[] = [];

  for (const f of readdirSync(dir).filter((x) => MD_RE.test(x)).sort()) {
    const content = readFileSync(join(dir, f), 'utf8');
    const slug = basename(f).replace(MD_RE, '');

    // Statement: first heading or first non-empty line, de-marked and clamped
    // to a one-liner. Fallback to the slug. The full file stays in the body,
    // so truncating the title loses nothing.
    let statement = '';
    for (const line of content.split('\n')) {
      if (line.trim() === '') continue;
      statement = line.trim().replace(/^#+\s*/, '').replace(/\s+/g, ' ');
      break;
    }
    if (!statement) statement = slug.replace(/[-_]/g, ' ');
    if (statement.length > MAX_STATEMENT) statement = statement.slice(0, MAX_STATEMENT - 1).trimEnd() + '…';

    const slugTags = slug.split(/[-_]/).filter((t) => t.length > 2).slice(0, 6);
    const id = generateId(used);
    used.add(id);
    const body = content.trim();

    out.push({
      type,
      statement,
      meta: {
        id,
        src,
        updated: date,
        tags: ['imported', 'claude-memory', ...slugTags],
      },
      body: body ? body + '\n' : '',
      raw: '', line: 0, dirty: true,
      sourceFile: join(dir, f),
    });
  }
  return out;
}

const NUMBERED_RE = /^(\d{3,5})-(.+)\.md$/;
const SUPERSEDED_RE = /superseded[- ]by[:\s]+(?:LR-|ADR-)?0*(\d+)/i;

interface Record_ {
  num: string;
  file: string;
  statement: string;
  body: string;
  supersededByNum: string | null;
}

/**
 * Import a directory of numbered markdown records as entries.
 * The first '# ' heading (or first non-empty line) becomes the statement;
 * the rest becomes the body. Returns entries ready for appendEntry().
 */
export function importNumberedDir(
  dir: string, opts?: { type?: string; src?: string; today?: string },
): ImportedEntry[] {
  const type = opts?.type ?? 'decision';
  const date = opts?.today ?? new Date().toISOString().slice(0, 10);

  // Pass 1: read every record.
  const records: Record_[] = [];
  for (const f of readdirSync(dir).filter((x) => NUMBERED_RE.test(x)).sort()) {
    const m = NUMBERED_RE.exec(f)!;
    const num = m[1].replace(/^0+/, '') || '0';
    const content = readFileSync(join(dir, f), 'utf8');
    const lines = content.split('\n');
    let statement = '';
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      statement = lines[i].trim().replace(/^#+\s*/, '');
      bodyStart = i + 1;
      break;
    }
    if (!statement) statement = m[2].replace(/-/g, ' ');
    const sup = SUPERSEDED_RE.exec(content);
    records.push({
      num, file: join(dir, f), statement,
      body: lines.slice(bodyStart).join('\n').trim(),
      supersededByNum: sup ? sup[1].replace(/^0+/, '') || '0' : null,
    });
  }

  // Pass 2: assign ids, then wire supersession (newer supersedes older).
  const used = new Set<string>();
  const idByNum = new Map<string, string>();
  for (const r of records) {
    const id = generateId(used);
    used.add(id);
    idByNum.set(r.num, id);
  }
  const supersedesByNum = new Map<string, string[]>();
  for (const r of records) {
    if (!r.supersededByNum || r.supersededByNum === r.num) continue; // ignore self-reference
    const older = idByNum.get(r.num);
    if (!older || !idByNum.has(r.supersededByNum)) continue;
    const list = supersedesByNum.get(r.supersededByNum) ?? [];
    list.push(older);
    supersedesByNum.set(r.supersededByNum, list);
  }

  return records.map((r): ImportedEntry => ({
    type,
    statement: r.statement,
    meta: {
      id: idByNum.get(r.num),
      src: opts?.src ?? 'user',
      updated: date,
      tags: ['imported', basename(dir)],
      ...(supersedesByNum.has(r.num) ? { supersedes: supersedesByNum.get(r.num) } : {}),
    },
    body: r.body ? r.body + '\n' : '',
    raw: '',
    line: 0,
    dirty: true,
    sourceFile: r.file,
  }));
}

#!/usr/bin/env node
/** mnemo — the MnemoDB CLI. Commands: init, list, show, doctor. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadStore, deriveIndex, doctor, liveEntries,
  planCompaction, applyCompaction, writeFileAtomic, withStoreLock,
  migrateProseFile, importNumberedDir, importClaudeMemoryDir, appendEntry, parse, serialize,
} from '@mnemodb/core';
import { readFileSync } from 'node:fs';

const [, , command = 'help', ...args] = process.argv;
const target = args.find((a) => !a.startsWith('--')) ?? '.';
const flags = new Set(args.filter((a) => a.startsWith('--')));

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function cmdInit(dir: string): number {
  const memory = join(dir, '.memory');
  if (existsSync(memory)) {
    console.error(`${memory} already exists — nothing to do.`);
    return 1;
  }
  mkdirSync(join(memory, 'episodes'), { recursive: true });
  const fm = (scope: string, title: string) =>
    `---\nmnemo: "0.1"\nscope: ${scope}\ntitle: "${title}"\nupdated: ${today()}\nbudget: 3000\n---\n\n`;
  writeFileSync(join(memory, 'project.mem.md'),
    fm('project', 'project memory') +
    'Project-level standing instructions go here (always loaded).\n');
  writeFileSync(join(memory, 'user.mem.md'), fm('user', 'user preferences'));
  writeFileSync(join(memory, 'archive.mem.md'), fm('project', 'archive'));
  // Mandatory union merge driver (spec §7.3, from Phase 0 evidence).
  const attrs = join(dir, '.gitattributes');
  const line = '*.mem.md merge=union\n';
  if (existsSync(attrs)) {
    console.log(`note: add '${line.trim()}' to your existing .gitattributes`);
  } else {
    writeFileSync(attrs, line);
  }
  // Keep the transient writer lock out of version control.
  const ignore = join(dir, '.gitignore');
  const ignoreLine = '.memory/.mnemo-lock/\n';
  if (existsSync(ignore)) {
    if (!readFileSync(ignore, 'utf8').includes('.mnemo-lock')) {
      writeFileSync(ignore, readFileSync(ignore, 'utf8').replace(/\n?$/, '\n') + ignoreLine);
    }
  } else {
    writeFileSync(ignore, ignoreLine);
  }
  console.log(`Initialized MnemoDB store in ${memory}`);
  return 0;
}

function cmdList(dir: string): number {
  const store = loadStore(dir);
  const index = deriveIndex(store, { includeCold: flags.has('--all') });
  if (index.length === 0) {
    console.log('No entries found.');
    return 0;
  }
  // Key liveness by file:line, not id — id-less entries have id null and would
  // otherwise always compare unequal and mis-render as superseded (audit LOW).
  const liveKey = new Set(liveEntries(store).map((l) => `${l.doc.path ?? ''}:${l.entry.line}`));
  for (const e of index) {
    const liveMark = liveKey.has(`${e.file}:${e.line}`) ? ' ' : 'x';
    console.log(
      `${liveMark} [${e.type.padEnd(8)}] ${(e.id ?? '----').padEnd(8)} ` +
      `${e.pin === 'always' ? '📌' : e.pin === 'cold' ? '❄' : ' '} ${e.statement}`,
    );
  }
  console.log(`\n${index.length} entries (x = superseded/expired; 📌 always-loaded; ❄ cold)`);
  return 0;
}

function cmdShow(dir: string, id: string | undefined): number {
  if (!id) { console.error('usage: mnemo show <id>'); return 1; }
  const store = loadStore(dir === id ? '.' : dir);
  for (const doc of store.docs) {
    for (const e of doc.entries) {
      if (e.meta.id === id) {
        process.stdout.write(e.raw.endsWith('\n') ? e.raw : e.raw + '\n');
        console.log(`— ${doc.path}:${e.line}`);
        return 0;
      }
    }
  }
  console.error(`No entry with id '${id}'.`);
  return 1;
}

function cmdDoctor(dir: string): number {
  const store = loadStore(dir);
  const report = doctor(store);
  const { stats } = report;
  console.log(
    `store: ${stats.files} file(s), ${stats.entries} entries ` +
    `(${stats.live} live, ${stats.expired} expired, ${stats.stale} stale)`,
  );
  console.log(
    `always-loaded tier: ≈${stats.alwaysTierTokens} tokens` +
    (stats.budget !== null ? ` (budget ${stats.budget})` : ''),
  );
  const errors = report.diagnostics.filter((d) => d.level === 'error');
  const warns = report.diagnostics.filter((d) => d.level === 'warn');
  for (const d of errors) console.log(`  ERROR ${d.rule}: ${d.message}`);
  for (const d of warns) console.log(`  warn  ${d.rule}: ${d.message}`);
  if (errors.length === 0 && warns.length === 0) console.log('No problems found.');
  return errors.length > 0 ? 1 : 0;
}

function cmdCompact(dir: string): number {
  const store = loadStore(dir);
  const plan = planCompaction(store);
  if (plan.moves.length === 0) {
    console.log('Nothing to compact — no expired or superseded entries outside the archive.');
    return 0;
  }
  for (const m of plan.moves) {
    console.log(`  ${m.reason.padEnd(10)} [${m.type}] ${m.id ?? '----'} — ${m.statement.slice(0, 60)}  (${m.from})`);
  }
  if (!flags.has('--write')) {
    console.log(`\n${plan.moves.length} entries would move to the archive. Dry run — pass --write to apply.`);
    return 0;
  }
  const written = withStoreLock(store.root, () => applyCompaction(store, plan));
  console.log(`\nMoved ${plan.moves.length} entries to the archive. Rewrote: ${written.join(', ')}`);
  console.log('Review the diff, then commit.');
  return 0;
}

function cmdMigrate(source: string): number {
  if (!source || source === '.') {
    console.error('usage: mnemo migrate <CLAUDE.md|AGENTS.md|numbered-dir|memory-dir --claude-memory> [--type <type>] [--into <store.mem.md>]');
    return 1;
  }
  const typeFlag = args.find((a) => a.startsWith('--type='))?.slice(7)
    ?? (flags.has('--type') ? args[args.indexOf('--type') + 1] : undefined);
  const isDir = existsSync(source) && !source.endsWith('.md');
  if (!isDir) {
    // Prose file → new store file with the prose as preamble. Original untouched.
    const out = source.replace(/\.md$/i, '') + '.mem.md';
    if (existsSync(out)) { console.error(`${out} already exists.`); return 1; }
    writeFileAtomic(out, migrateProseFile(source));
    console.log(`Wrote ${out} — your original ${source} is untouched.`);
    console.log('Everything migrated as preamble (always-loaded). Structure it into typed entries over time.');
    return 0;
  }
  // Directory → typed entries appended to a target store file.
  //   --claude-memory : a Claude Code native-memory dir (slug-named .md topics)
  //   default         : ADR-style numbered records (NNNN-slug.md)
  const intoIdx = args.indexOf('--into');
  const target = intoIdx >= 0 ? args[intoIdx + 1] : 'imported.mem.md';
  const claudeMem = flags.has('--claude-memory');
  // Load the target first so imported ids can be seeded against existing ones
  // (no collisions), and reuse the same doc for the append.
  const doc = existsSync(target)
    ? parse(readFileSync(target, 'utf8'), target)
    : parse(`---\nmnemo: "0.1"\nscope: project\ntitle: "imported from ${source}"\nupdated: ${today()}\n---\n`, target);
  const existingIds = doc.entries.map((e) => e.meta.id).filter((x) => x != null);
  const entries = claudeMem
    ? importClaudeMemoryDir(source, { type: typeFlag, existingIds })
    : importNumberedDir(source, { type: typeFlag ?? 'decision', existingIds });
  if (entries.length === 0) {
    console.error(claudeMem
      ? `No .md files found in ${source}.`
      : `No numbered records (NNNN-slug.md) found in ${source} (use --claude-memory for a Claude Code memory dir).`);
    return 1;
  }
  for (const e of entries) appendEntry(doc, e);
  writeFileAtomic(target, serialize(doc));
  console.log(`Imported ${entries.length} records from ${source} into ${target} (type: ${typeFlag ?? 'decision'}).`);
  return 0;
}

function help(): number {
  console.log(`mnemo — MnemoDB agent memory CLI (spec v0.1)

usage: mnemo <command> [path] [flags]

commands:
  init [dir]      create a .memory/ store + .gitattributes (merge=union)
  list [dir]      index of all entries (--all includes cold tier)
  show <id>       print one entry verbatim
  doctor [dir]    lint the store: damage, duplicates, expiry, budget
  compact [dir]   move expired/superseded entries to the archive (dry-run; --write to apply)
  migrate <src>   CLAUDE.md/AGENTS.md → .mem.md preamble; numbered dir (ADRs,
                  learning-records) → typed entries; or a Claude Code memory
                  dir with --claude-memory (--type, --into <file>)
`);
  return 0;
}

let exit: number;
try {
  exit =
    command === 'init' ? cmdInit(target) :
    command === 'list' ? cmdList(target) :
    command === 'show' ? cmdShow(args[1] ? args[0] : '.', args[1] ?? args[0]) :
    command === 'doctor' ? cmdDoctor(target) :
    command === 'compact' ? cmdCompact(target) :
    command === 'migrate' ? cmdMigrate(target) :
    help();
} catch (e) {
  // Friendly one-line error instead of a raw stack trace (audit LOW).
  console.error(`mnemo ${command}: ${(e as Error).message}`);
  exit = 1;
}
process.exit(exit);

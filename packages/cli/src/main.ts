#!/usr/bin/env node
/** mnemo — the MnemoDB CLI. Commands: init, list, show, doctor. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadStore, deriveIndex, doctor, liveEntries,
} from '@mnemodb/core';

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
  const live = new Set(liveEntries(store).map((l) => l.entry));
  for (const e of index) {
    const liveMark = [...live].some((x) => x.meta.id === e.id) ? ' ' : 'x';
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

function help(): number {
  console.log(`mnemo — MnemoDB agent memory CLI (spec v0.1)

usage: mnemo <command> [path] [flags]

commands:
  init [dir]      create a .memory/ store + .gitattributes (merge=union)
  list [dir]      index of all entries (--all includes cold tier)
  show <id>       print one entry verbatim
  doctor [dir]    lint the store: damage, duplicates, expiry, budget
`);
  return 0;
}

const exit =
  command === 'init' ? cmdInit(target) :
  command === 'list' ? cmdList(target) :
  command === 'show' ? cmdShow(args[1] ? args[0] : '.', args[1] ?? args[0]) :
  command === 'doctor' ? cmdDoctor(target) :
  help();
process.exit(exit);

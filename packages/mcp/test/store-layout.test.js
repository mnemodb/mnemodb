/**
 * A store born from the first memory_remember must be a complete store
 * (directory review, 2026-10-13). Before 0.1.21 it got only project.mem.md:
 * no archive, so compaction silently moved nothing, and no union merge driver.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remember, compact } from '../dist/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', '..', 'cli', 'dist', 'main.js');
const NOW = new Date('2026-10-13');
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const ls = (d) => readdirSync(d, { recursive: true }).map(String).map((p) => p.replace(/\\/g, '/')).sort();
const MEM_LAYOUT = ['README.md', 'archive.mem.md', 'episodes', 'episodes/.gitkeep', 'project.mem.md', 'user.mem.md'];

test('first remember creates the full store layout, all inside .memory/', () => {
  const dir = tmp('layout-new-');
  remember(dir, { statement: 'We ship on Tuesdays', now: NOW });
  assert.deepEqual(ls(dir).filter((p) => !p.startsWith('.memory')), [], 'nothing outside .memory/');
  const mem = join(dir, '.memory');
  assert.deepEqual(ls(mem), ['.gitattributes', '.gitignore', ...MEM_LAYOUT].sort());
  assert.equal(readFileSync(join(mem, '.gitattributes'), 'utf8'), '*.mem.md merge=union\n');
  assert.match(readFileSync(join(mem, '.gitignore'), 'utf8'), /\.mnemo-lock\//);
  assert.match(readFileSync(join(mem, 'project.mem.md'), 'utf8'), /We ship on Tuesdays/);
});

test('first-write store has the same .mem.md layout as `mnemo init`', () => {
  const a = tmp('layout-init-'), b = tmp('layout-write-');
  execFileSync(process.execPath, [CLI, 'init', a]);
  remember(b, { statement: 'anything', now: NOW });
  const visible = (d) => ls(join(d, '.memory')).filter((p) => !p.startsWith('.git') && !p.startsWith('.mnemo-lock'));
  assert.deepEqual(visible(b), visible(a));
});

test('compaction works in a store born from a first write', () => {
  const dir = tmp('layout-compact-');
  const old = remember(dir, { statement: 'Deploys need one approval', now: NOW });
  remember(dir, { statement: 'Deploys need two approvals', supersedes: [old.id], now: NOW });
  const r = compact(dir, { write: true, now: NOW });
  assert.equal(r.moves.length, 1, 'the superseded entry moves');
  assert.match(readFileSync(join(dir, '.memory', 'archive.mem.md'), 'utf8'), /one approval/);
  assert.doesNotMatch(readFileSync(join(dir, '.memory', 'project.mem.md'), 'utf8'), /one approval/);
});

test('a pre-0.1.21 store with no archive file can still compact', () => {
  const dir = tmp('layout-legacy-');
  const mem = join(dir, '.memory');
  mkdirSync(mem);
  // Exactly what a first write produced before this fix: one file, no archive.
  writeFileSync(join(mem, 'project.mem.md'), '---\nmnemo: "0.1"\nscope: project\ntitle: "project memory"\nupdated: 2026-10-01\n---\n');
  const old = remember(dir, { statement: 'Use port 8080', now: NOW });
  remember(dir, { statement: 'Use port 9090', supersedes: [old.id], now: NOW });
  assert.ok(!existsSync(join(mem, 'archive.mem.md')), 'precondition: no archive');
  const dry = compact(dir, { now: NOW });
  assert.equal(dry.moves.length, 1, 'dry run sees the move');
  assert.ok(!existsSync(join(mem, 'archive.mem.md')), 'dry run writes nothing');
  compact(dir, { write: true, now: NOW });
  assert.match(readFileSync(join(mem, 'archive.mem.md'), 'utf8'), /port 8080/);
});

test('an existing store is never re-scaffolded by a write', () => {
  const dir = tmp('layout-keep-');
  const mem = join(dir, '.memory');
  mkdirSync(mem);
  writeFileSync(join(mem, 'project.mem.md'), '---\nmnemo: "0.1"\nscope: project\ntitle: "p"\nupdated: 2026-10-01\n---\n');
  remember(dir, { statement: 'Keep my layout', now: NOW });
  assert.deepEqual(ls(mem), ['project.mem.md'], 'no files added to a store the user already has');
});

/**
 * CLI surface tests. The CLI is what a human touches directly, so its output
 * and the shape of what `init` scaffolds are part of the contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadStore, deriveIndex } from '@mnemodb/core';

const CLI = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const run = (args, cwd) =>
  execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });

test('init scaffolds a store that explains itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-init-'));
  run(['init', dir]);
  const mem = join(dir, '.memory');

  for (const f of ['project.mem.md', 'user.mem.md', 'archive.mem.md', 'README.md']) {
    assert.ok(existsSync(join(mem, f)), `${f} is created`);
  }
  // Git drops empty directories, so episodes/ needs a keeper to survive a clone.
  assert.ok(existsSync(join(mem, 'episodes', '.gitkeep')), 'episodes/ survives git');

  // The README must answer the two questions an empty store provokes.
  const readme = readFileSync(join(mem, 'README.md'), 'utf8');
  assert.match(readme, /Empty is normal/i, 'README addresses the empty-store confusion');
  assert.match(readme, /user\.mem\.md/, 'README explains user-scope routing');
  assert.match(readme, /episodes/, 'README explains the empty episodes folder');
});

test('the store README is documentation, never memory', () => {
  // It is not a .mem.md, so the loader must ignore it entirely — otherwise the
  // explanation would load into the agent's context in every single session.
  const dir = mkdtempSync(join(tmpdir(), 'cli-readme-'));
  run(['init', dir]);
  const store = loadStore(dir);
  assert.equal(store.docs.length, 3, 'only the three .mem.md files load');
  assert.ok(!store.docs.some((d) => (d.path ?? '').includes('README')), 'README is not a doc');
  assert.equal(deriveIndex(store).length, 0, 'a fresh store has no entries');
});

test('init refuses to clobber an existing store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-twice-'));
  run(['init', dir]);
  assert.throws(() => run(['init', dir]), /./, 'a second init exits non-zero');
});

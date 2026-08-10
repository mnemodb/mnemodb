import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recall, remember, review, compact, bootContext } from '../dist/engine.js';

const DOGFOOD = fileURLToPath(new URL('../../../fixtures/dogfood', import.meta.url));
const NOW = new Date('2026-08-10T12:00:00Z');

function freshStore() {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-'));
  cpSync(DOGFOOD, tmp, { recursive: true });
  return tmp;
}

test('recall finds the license decision for a licensing query', () => {
  const hits = recall(freshStore(), 'which license did we choose', { now: NOW });
  assert.ok(hits.length > 0);
  assert.equal(hits[0].id, 'lcns', `expected lcns first, got ${hits[0].id}`);
  assert.equal(hits[0].type, 'decision');
});

test('recall ranks the TypeScript decision for a language query', () => {
  const hits = recall(freshStore(), 'typescript language choice rust', { now: NOW });
  assert.equal(hits[0].id, 't5l4');
});

test('recall never returns superseded entries', () => {
  const hits = recall(freshStore(), 'decide licenses repo strategy monorepo', { now: NOW, limit: 25 });
  const ids = hits.map((h) => h.id);
  assert.ok(!ids.includes('l1cx') && !ids.includes('r3po'), 'superseded todos excluded');
});

test('recall scope filter works', () => {
  const hits = recall(freshStore(), 'decisive recommendations reasoning', { scope: 'user', now: NOW });
  assert.ok(hits.every((h) => h.scope === 'user'));
  assert.ok(hits.some((h) => h.id === 'z1go'));
});

test('remember creates a typed entry with agent provenance and finds it via recall', () => {
  const dir = freshStore();
  const res = remember(dir, {
    statement: 'CI pipeline runs on Node 20 and 22 via GitHub Actions',
    type: 'fact', tags: ['ci'], now: NOW,
  });
  assert.equal(res.status, 'created');
  assert.equal(res.file, 'project.mem.md');
  const content = readFileSync(join(dir, '.memory', 'project.mem.md'), 'utf8');
  assert.match(content, /## fact: CI pipeline runs on Node 20 and 22/);
  assert.match(content, /src: agent/);
  const hits = recall(dir, 'github actions node ci', { now: NOW });
  assert.equal(hits[0].id, res.id);
});

test('remember refuses near-duplicates', () => {
  const dir = freshStore();
  const res = remember(dir, {
    statement: 'npm package mnemodb@0.0.1 was published 2026-08-10 by zivuch',
    type: 'fact', now: NOW,
  });
  assert.equal(res.status, 'duplicate');
  assert.equal(res.duplicateOf, 'p0b1');
});

test('remember with supersedes creates the revision entry', () => {
  const dir = freshStore();
  const res = remember(dir, {
    statement: 'First integration target is Claude Code, then Cursor via MCP',
    type: 'decision', supersedes: ['c1cd'], now: NOW,
  });
  assert.equal(res.status, 'superseded-and-created');
  const hits = recall(dir, 'integration target claude code cursor', { now: NOW, limit: 25 });
  assert.ok(!hits.some((h) => h.id === 'c1cd'), 'old decision now superseded');
  assert.ok(hits.some((h) => h.id === res.id));
});

test('remember to user scope writes user.mem.md', () => {
  const dir = freshStore();
  const res = remember(dir, {
    statement: 'Zivuch works in Git Bash on Windows', type: 'fact', scope: 'user', now: NOW,
  });
  assert.equal(res.file, 'user.mem.md');
  assert.match(readFileSync(join(dir, '.memory', 'user.mem.md'), 'utf8'), /Git Bash on Windows/);
});

test('review reports clean dogfood store and sane budget numbers', () => {
  const rep = review(freshStore(), NOW);
  assert.deepEqual(rep.errors, []);
  assert.deepEqual(rep.contradictions, []);
  assert.ok(rep.alwaysTierTokens > 0 && rep.alwaysTierTokens < (rep.budget ?? Infinity));
});

test('compact dry-run then write, engine-level', () => {
  const dir = freshStore();
  const dry = compact(dir, { now: NOW });
  assert.equal(dry.applied, false);
  assert.deepEqual(dry.moves.map((m) => m.id).sort(), ['l1cx', 'r3po']);
  const wet = compact(dir, { write: true, now: NOW });
  assert.equal(wet.applied, true);
  const again = compact(dir, { now: NOW });
  assert.deepEqual(again.moves, [], 'idempotent: second compaction finds nothing');
});

test('bootContext includes preamble and pinned entries only', () => {
  const ctx = bootContext(freshStore(), NOW);
  assert.match(ctx, /spec-first project/i, 'preamble present');
  assert.match(ctx, /named MnemoDB, not AMF/, 'pinned decision present');
  assert.ok(!ctx.includes('TypeScript first'), 'auto-tier entries not in boot context');
});

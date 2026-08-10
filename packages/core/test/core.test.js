import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parse, serialize, mergeDocs, loadStore, deriveIndex, doctor,
  liveEntries, alwaysTier, isExpired, ttlDays, appendEntry, generateId,
} from '../dist/index.js';

const FIXTURES = new URL('../../../fixtures', import.meta.url).pathname;
const DOGFOOD = join(FIXTURES, 'dogfood');

function dogfoodFiles() {
  const root = join(DOGFOOD, '.memory');
  const files = [];
  for (const f of readdirSync(root)) {
    if (f.endsWith('.mem.md')) files.push(join(root, f));
  }
  for (const f of readdirSync(join(root, 'episodes'))) {
    if (f.endsWith('.mem.md')) files.push(join(root, 'episodes', f));
  }
  return files;
}

test('round-trip is byte-stable on every dogfood file', () => {
  for (const file of dogfoodFiles()) {
    const src = readFileSync(file, 'utf8');
    assert.equal(serialize(parse(src)), src, `round-trip mismatch: ${file}`);
  }
});

test('dogfood store parses fully with no error diagnostics', () => {
  const store = loadStore(DOGFOOD);
  assert.equal(store.docs.length, 4);
  const allDiags = store.docs.flatMap((d) => d.diagnostics);
  assert.deepEqual(allDiags.filter((d) => d.level === 'error'), []);
  const entries = store.docs.reduce((n, d) => n + d.entries.length, 0);
  assert.equal(entries, 16);
});

test('index derivation excludes cold tier by default', () => {
  const store = loadStore(DOGFOOD);
  const index = deriveIndex(store);
  assert.ok(index.every((e) => e.pin !== 'cold'));
  const all = deriveIndex(store, { includeCold: true });
  assert.ok(all.length > index.length, 'archive cold entry should appear with includeCold');
});

test('supersession removes both todos and the archived AMF decision from live set', () => {
  const store = loadStore(DOGFOOD);
  const liveIds = new Set(liveEntries(store).map((l) => l.entry.meta.id));
  assert.ok(!liveIds.has('l1cx'), 'l1cx superseded by lcns');
  assert.ok(!liveIds.has('r3po'), 'r3po superseded by mono');
  assert.ok(!liveIds.has('a0f1'), 'a0f1 superseded by n4m1');
  assert.ok(liveIds.has('lcns') && liveIds.has('mono') && liveIds.has('n4m1'));
});

test('always tier contains the pinned entries', () => {
  const ids = alwaysTier(loadStore(DOGFOOD)).map((l) => l.entry.meta.id).sort();
  assert.deepEqual(ids, ['g4p1', 'n4m1', 'z1go']);
});

test('ttl parsing and expiry', () => {
  assert.equal(ttlDays('90d', 'note'), 90);
  assert.equal(ttlDays('6m', 'note'), 180);
  assert.equal(ttlDays('none', 'episode'), null);
  assert.equal(ttlDays(undefined, 'episode'), 30);
  assert.equal(ttlDays(undefined, 'fact'), null);
  const episode = parse(
    '## episode: old session\n`mnemo aaaa | updated: 2026-01-01 | ttl: 30d`\n',
  ).entries[0];
  assert.equal(isExpired(episode, new Date('2026-08-10')), true);
  assert.equal(isExpired(episode, new Date('2026-01-15')), false);
});

test('malformed entries degrade with diagnostics, never throw or vanish', () => {
  const src = '## fact: good entry\n`mnemo ok01`\n\n' +
    '## fact: bad metadata\n`mnemo NOT VALID ###`\n\nBody survives.\n' +
    '## untyped heading here\n';
  const doc = parse(src);
  assert.equal(doc.entries.length, 3);
  assert.ok(doc.entries[1].malformed, 'bad metadata flagged');
  assert.match(doc.entries[1].raw, /Body survives/);
  assert.equal(doc.entries[2].type, 'note');
  assert.equal(serialize(doc), src, 'degraded doc still round-trips byte-stable');
});

test('entries without blank-line separation parse (union-driver tolerance)', () => {
  const src = '## fact: first\n`mnemo aa11`\n## fact: second\n`mnemo bb22`\n';
  const doc = parse(src);
  assert.equal(doc.entries.length, 2);
  assert.equal(serialize(doc), src);
});

test('doctor finds duplicate ids, orphan supersedes, and contradictions', () => {
  const store = loadStore(join(FIXTURES, 'corrupted'));
  const report = doctor(store);
  const rules = new Set(report.diagnostics.map((d) => d.rule));
  assert.ok(rules.has('duplicate-id'), 'duplicate-id');
  assert.ok(rules.has('orphan-supersedes'), 'orphan-supersedes');
  assert.ok(rules.has('contradiction'), 'contradiction');
  assert.ok(rules.has('conflict-marker'), 'conflict-marker');
  assert.ok(rules.has('meta-unparseable'), 'meta-unparseable');
});

test('doctor passes the dogfood store with no errors', () => {
  const report = doctor(loadStore(DOGFOOD));
  assert.deepEqual(report.diagnostics.filter((d) => d.level === 'error'), []);
});

test('merge: union by id, revision race by updated, anonymous dedupe', () => {
  const base = '## fact: shared\n`mnemo ss01 | updated: 2026-08-01`\n\n';
  const ours = parse(base + '## fact: ours only\n`mnemo oo01`\n');
  const theirs = parse(
    '## fact: shared REVISED\n`mnemo ss01 | updated: 2026-08-09`\n\n' +
    '## fact: theirs only\n`mnemo tt01`\n');
  const merged = mergeDocs(ours, theirs);
  const ids = merged.entries.map((e) => e.meta.id);
  assert.deepEqual([...ids].sort(), ['oo01', 'ss01', 'tt01']);
  const shared = merged.entries.find((e) => e.meta.id === 'ss01');
  assert.match(shared.statement, /REVISED/, 'later updated wins');
});

test('merge is commutative and idempotent on entry sets', () => {
  const a = parse('## fact: A\n`mnemo aaa1 | updated: 2026-08-01`\n');
  const b = parse('## fact: B\n`mnemo bbb1 | updated: 2026-08-02`\n');
  const ab = mergeDocs(a, b).entries.map((e) => e.meta.id).sort();
  const ba = mergeDocs(b, a).entries.map((e) => e.meta.id).sort();
  assert.deepEqual(ab, ba);
  const aa = mergeDocs(a, a).entries.length;
  assert.equal(aa, 1);
});

test('appendEntry produces parseable, gap-separated output', () => {
  const doc = parse('## fact: existing\n`mnemo ex01`\n');
  appendEntry(doc, {
    type: 'insight', statement: 'appending works',
    meta: { id: generateId(), src: 'agent' }, body: '', raw: '', line: 0,
  });
  const out = serialize(doc);
  const reparsed = parse(out);
  assert.equal(reparsed.entries.length, 2);
  assert.equal(reparsed.entries[1].type, 'insight');
});

test('untyped markdown file (CLAUDE.md) is a valid all-preamble document', () => {
  const src = '# My instructions\n\nAlways run tests.\n\nUse pnpm.\n';
  const doc = parse(src);
  assert.equal(doc.frontMatter, null);
  assert.equal(doc.entries.length, 0);
  assert.equal(doc.preamble, src);
  assert.equal(serialize(doc), src);
});

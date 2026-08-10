import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parse, serialize, mergeDocs, loadStore, deriveIndex, doctor,
  liveEntries, alwaysTier, isExpired, ttlDays, appendEntry, generateId,
} from '../dist/index.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures', import.meta.url));
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
  assert.equal(entries, 25);
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

test('compaction plan moves superseded entries to archive; apply is atomic and reparseable', async () => {
  const { mkdtempSync, cpSync, readFileSync: rf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { planCompaction, applyCompaction } = await import('../dist/index.js');
  const tmp = mkdtempSync(join(tmpdir(), 'compact-'));
  cpSync(DOGFOOD, tmp, { recursive: true });
  const store = loadStore(tmp);
  const plan = planCompaction(store, new Date('2026-08-10'));
  const movedIds = plan.moves.map((m) => m.id).sort();
  assert.deepEqual(movedIds, ['l1cx', 'r3po'], 'both superseded todos move');
  assert.ok(plan.moves.every((m) => m.reason === 'superseded'));
  applyCompaction(store, plan);
  const after = loadStore(tmp);
  const report = doctor(after);
  assert.deepEqual(report.diagnostics.filter((d) => d.level === 'error'), []);
  const archive = after.docs.find((d) => d.path.endsWith('archive.mem.md'));
  const archiveIds = archive.entries.map((e) => e.meta.id).sort();
  assert.deepEqual(archiveIds, ['a0f1', 'l1cx', 'r3po']);
  assert.ok(archive.entries.every((e) => e.meta.id !== 'a0f1' ? e.meta.pin === 'cold' : true));
});

test('compaction with future clock also expires the episode', async () => {
  const { mkdtempSync, cpSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { planCompaction } = await import('../dist/index.js');
  const tmp = mkdtempSync(join(tmpdir(), 'compact2-'));
  cpSync(DOGFOOD, tmp, { recursive: true });
  const plan = planCompaction(loadStore(tmp), new Date('2027-01-01'));
  const reasons = new Set(plan.moves.map((m) => m.reason));
  assert.ok(reasons.has('expired'), 'episode expires under future clock');
  assert.ok(plan.moves.some((m) => m.id === 's8dy'));
});

test('migrateProseFile wraps CLAUDE.md losslessly as preamble', async () => {
  const { mkdtempSync, writeFileSync: wf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { migrateProseFile } = await import('../dist/index.js');
  const tmp = mkdtempSync(join(tmpdir(), 'mig-'));
  const src = join(tmp, 'CLAUDE.md');
  const original = '# Rules\n\nAlways run tests.\nNever push to main.\n';
  wf(src, original);
  const out = migrateProseFile(src, { today: '2026-08-10' });
  const doc = parse(out);
  assert.equal(doc.frontMatter.mnemo, '0.1');
  assert.equal(doc.preamble, '\n' + original, 'prose preserved byte-for-byte after front matter gap');
  assert.equal(doc.entries.length, 0);
});

test('importNumberedDir maps records to entries and wires supersession', async () => {
  const { mkdtempSync, writeFileSync: wf, mkdirSync: mkd } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { importNumberedDir, appendEntry: append } = await import('../dist/index.js');
  const tmp = mkdtempSync(join(tmpdir(), 'adr-'));
  const dir = join(tmp, 'learning-records');
  mkd(dir);
  wf(join(dir, '0001-old-belief.md'), '# We thought X was true\n\nStatus: superseded by LR-0002\n\nDetails.\n');
  wf(join(dir, '0002-corrected.md'), '# Actually Y is true\n\nEvidence: test run.\n');
  const entries = importNumberedDir(dir, { type: 'insight', today: '2026-08-10' });
  assert.equal(entries.length, 2);
  const older = entries[0], newer = entries[1];
  assert.equal(older.statement, 'We thought X was true');
  assert.deepEqual(newer.meta.supersedes, [older.meta.id], 'newer supersedes older');
  // Round-trip through a document
  const doc = parse('---\nmnemo: "0.1"\nscope: project\ntitle: "t"\n---\n');
  for (const e of entries) append(doc, e);
  const reparsed = parse(serialize(doc));
  assert.equal(reparsed.entries.length, 2);
  assert.equal(reparsed.entries[0].type, 'insight');
});

test('CRLF documents (Windows checkouts) parse with correct types and stay byte-stable', () => {
  const src = '---\r\nmnemo: "0.1"\r\nscope: project\r\ntitle: "crlf"\r\n---\r\n\r\n' +
    '## decision: CRLF files parse correctly\r\n`mnemo crlf01 | src: user | conf: high`\r\n\r\nBody line.\r\n';
  const doc = parse(src);
  assert.ok(doc.frontMatter, 'front matter detected despite CRLF');
  assert.equal(doc.frontMatter.mnemo, '0.1');
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].type, 'decision', 'typed entry, not degraded to note');
  assert.equal(doc.entries[0].meta.id, 'crlf01');
  assert.equal(doc.entries[0].meta.conf, 'high');
  assert.equal(serialize(doc), src, 'CRLF bytes preserved exactly on round-trip');
});

test('fenced code blocks containing ## lines are not split into entries', () => {
  const src = '## fact: build script structure\n`mnemo cb01 | src: agent`\n\n' +
    'The script:\n\n```markdown\n## fact: EXAMPLE inside a fence\n`mnemo fake1`\n```\n\nEnd.\n' +
    '## fact: real second entry\n`mnemo cb02`\n\n~~~\n## also fenced with tildes\n~~~\n';
  const doc = parse(src);
  assert.equal(doc.entries.length, 2, 'fence content must not create entries');
  assert.equal(doc.entries[0].meta.id, 'cb01');
  assert.equal(doc.entries[1].meta.id, 'cb02');
  assert.match(doc.entries[0].body, /EXAMPLE inside a fence/, 'fence stays in body');
  assert.equal(serialize(doc), src, 'byte-stable with fences');
});

test('store lock: held lock blocks, stale lock is broken', async () => {
  const { mkdtempSync, mkdirSync: mkd, utimesSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { withStoreLock } = await import('../dist/index.js');
  const root = mkdtempSync(join(tmpdir(), 'lock-'));
  // basic acquire/release
  assert.equal(withStoreLock(root, () => 42), 42);
  // held fresh lock → timeout error
  mkd(join(root, '.mnemo-lock'));
  assert.throws(() => withStoreLock(root, () => 0, { timeoutMs: 200 }), /Timed out/);
  // stale lock (mtime 60s ago) → broken and acquired
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(root, '.mnemo-lock'), old, old);
  assert.equal(withStoreLock(root, () => 'stolen', { timeoutMs: 2000 }), 'stolen');
});

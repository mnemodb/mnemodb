/**
 * Retrieval-accuracy regression guard.
 *
 * Runs the labeled benchmark fixtures through the real `recall` engine and holds
 * the line on retrieval quality: the `exact` bucket must stay strong, negatives
 * must never surface a spurious hit, and overall recall/MRR must not regress.
 * The `paraphrase` bucket is only loosely floored — it is the known-weak case
 * that a future semantic ranker is meant to lift, tracked by the report
 * (`node packages/mcp/bench/run.mjs`), not gated here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { recall } from '../dist/engine.js';
import { CASES } from '../bench/fixtures.mjs';
import { scoreBucket } from '../bench/metrics.mjs';

const K = 5;
const STORE = fileURLToPath(new URL('../../../fixtures/dogfood', import.meta.url));
const NOW = new Date('2026-08-17T00:00:00Z');
const retrieve = (query) => recall(STORE, query, { now: NOW, limit: K }).map((h) => h.id);

const bucket = (kind) => scoreBucket(CASES.filter((c) => c.kind === kind), retrieve, K);

test('bench: exact queries stay strong (regression floor)', () => {
  const b = bucket('exact');
  assert.ok(b.hitAt1 >= 0.88, `exact hit@1 ${b.hitAt1.toFixed(2)} < 0.88`);
  assert.ok(b.recallAtK >= 0.88, `exact recall@${K} ${b.recallAtK.toFixed(2)} < 0.88`);
  assert.ok(b.mrr >= 0.90, `exact MRR ${b.mrr.toFixed(2)} < 0.90`);
});

test('bench: negatives surface no spurious hits', () => {
  for (const c of CASES.filter((x) => x.kind === 'negative')) {
    assert.equal(retrieve(c.query).length, 0, `"${c.query}" should return nothing`);
  }
});

test('bench: overall recall/MRR do not regress', () => {
  const all = scoreBucket(CASES, retrieve, K);
  assert.ok(all.recallAtK >= 0.80, `overall recall@${K} ${all.recallAtK.toFixed(2)} < 0.80`);
  assert.ok(all.mrr >= 0.75, `overall MRR ${all.mrr.toFixed(2)} < 0.75`);
});

test('bench: paraphrase does not silently rot to zero (loose floor)', () => {
  const b = bucket('paraphrase');
  assert.ok(b.recallAtK >= 0.40, `paraphrase recall@${K} ${b.recallAtK.toFixed(2)} < 0.40 (known-weak, but not zero)`);
});

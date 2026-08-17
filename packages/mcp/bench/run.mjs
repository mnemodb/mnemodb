/**
 * Retrieval-accuracy benchmark report.
 *
 *   node packages/mcp/bench/run.mjs
 *
 * Runs the labeled fixtures through the real `recall` engine over the dogfood
 * store and prints precision@k / recall@k / hit@1 / MRR, bucketed by kind. The
 * exact vs paraphrase gap is the headline number: it quantifies how much a
 * semantic ranker could add before one is built.
 */
import { fileURLToPath } from 'node:url';
import { recall } from '../dist/engine.js';
import { CASES } from './fixtures.mjs';
import { scoreBucket } from './metrics.mjs';

const K = 5;
const STORE = fileURLToPath(new URL('../../../fixtures/dogfood', import.meta.url));
const NOW = new Date('2026-08-17T00:00:00Z');

const retrieve = (query) =>
  recall(STORE, query, { now: NOW, limit: K }).map((h) => h.id);

const kinds = [...new Set(CASES.map((c) => c.kind))];
const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';

console.log(`\nRetrieval benchmark — dogfood store, k=${K}, ${CASES.length} cases\n`);
console.log('bucket        n   P@k    R@k    hit@1  MRR');
console.log('----------  ---  -----  -----  -----  -----');

const buckets = {};
for (const kind of kinds) {
  const b = scoreBucket(CASES.filter((c) => c.kind === kind), retrieve, K);
  buckets[kind] = b;
  console.log(
    kind.padEnd(10), String(b.n).padStart(3),
    pct(b.precisionAtK), pct(b.recallAtK), pct(b.hitAt1), pct(b.mrr),
  );
}
const all = scoreBucket(CASES, retrieve, K);
console.log('----------  ---  -----  -----  -----  -----');
console.log('ALL       ', String(all.n).padStart(3), pct(all.precisionAtK), pct(all.recallAtK), pct(all.hitAt1), pct(all.mrr));

if (buckets.exact && buckets.paraphrase) {
  const gap = buckets.exact.recallAtK - buckets.paraphrase.recallAtK;
  console.log(`\nexact→paraphrase recall gap: ${pct(gap)}  (the headroom a semantic ranker targets)`);
}

// Misses worth eyeballing.
const misses = all.rows.filter((x) => x.kind !== 'negative' && x.r < 1);
if (misses.length) {
  console.log('\nmisses (recall@k < 100%):');
  for (const m of misses) {
    console.log(`  [${m.kind}] "${m.query}"  expected ${JSON.stringify(m.expected)}  got ${JSON.stringify(m.retrieved.slice(0, 3))}`);
  }
}
console.log('');

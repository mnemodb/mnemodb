# Retrieval-accuracy benchmark

A labeled measurement of how well `recall` finds the right memory, so retrieval
quality has a **number** — and regressions get caught before release.

```
npm run bench          # print the report
```

## What it measures

Each fixture in [`fixtures.mjs`](./fixtures.mjs) is a `query → expected entry ids`
label over the [dogfood store](../../../fixtures/dogfood), bucketed by kind:

| bucket | what it probes |
|---|---|
| `exact` | query shares surface tokens with the target — the regression floor |
| `paraphrase` | same intent, few/no shared tokens — the case semantic search targets |
| `multiterm` | one query, several relevant entries |
| `negative` | nothing relevant exists — a good ranker returns nothing |

Metrics ([`metrics.mjs`](./metrics.mjs)): **precision@k**, **recall@k**,
**hit@1**, and **MRR**, per bucket and overall (k=5).

## Current baseline (keyword recall)

```
bucket        n   P@k    R@k    hit@1  MRR
exact         9  20.0% 100.0% 100.0% 100.0%
paraphrase    5  12.0%  60.0%  20.0%  36.7%
multiterm     3  33.3%  88.9% 100.0% 100.0%
negative      2   0.0% 100.0% 100.0% 100.0%
ALL          19  17.9%  87.7%  78.9%  83.3%
```

The headline is the **~40-point exact→paraphrase recall gap**: keyword recall
nails exact queries and rejects irrelevant ones cleanly, but misses paraphrases.
That gap is the measured headroom a semantic ranker would target — build it
against this fixture set so any gain is proven, not assumed.

(precision@k is capped at `1/k` for single-answer queries, so read recall@k /
hit@1 / MRR for those; precision matters for the multi-answer bucket.)

## Regression guard

[`../test/retrieval-bench.test.js`](../test/retrieval-bench.test.js) runs in CI:
the `exact` bucket must stay strong, negatives must surface no spurious hits, and
overall recall/MRR must not regress. `paraphrase` is only loosely floored (it's
the known-weak case tracked by the report, not gated).

## Extending

Add cases to `fixtures.mjs` — keep `expected` to **live** entries (never
superseded ids), and label the `kind`. To benchmark a new ranker, point the
`retrieve(query)` function in `run.mjs` / the test at it and compare buckets.

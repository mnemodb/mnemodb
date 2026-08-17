/**
 * Retrieval metrics. `retrieved` is an ordered list of entry ids (best first);
 * `expected` is the unordered set of relevant ids.
 */

/** Fraction of the top-k that are relevant. k defaults to retrieved.length. */
export function precisionAtK(retrieved, expected, k = retrieved.length) {
  if (k === 0) return 0;
  const exp = new Set(expected);
  const top = retrieved.slice(0, k);
  const hit = top.filter((id) => exp.has(id)).length;
  return hit / k;
}

/** Fraction of the expected set found in the top-k. */
export function recallAtK(retrieved, expected, k = retrieved.length) {
  if (expected.length === 0) return 1; // nothing to find → trivially satisfied
  const exp = new Set(expected);
  const top = new Set(retrieved.slice(0, k));
  let found = 0;
  for (const id of exp) if (top.has(id)) found++;
  return found / expected.length;
}

/** 1 if the top-1 result is relevant, else 0. */
export function hitAt1(retrieved, expected) {
  if (expected.length === 0) return retrieved.length === 0 ? 1 : 0;
  return expected.includes(retrieved[0]) ? 1 : 0;
}

/** Reciprocal rank of the first relevant result (0 if none in the list). */
export function reciprocalRank(retrieved, expected) {
  if (expected.length === 0) return retrieved.length === 0 ? 1 : 0;
  const exp = new Set(expected);
  for (let i = 0; i < retrieved.length; i++) {
    if (exp.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Score one bucket of cases with a retrieval function `retrieve(query) -> ids`.
 * Returns aggregate metrics plus per-case detail.
 */
export function scoreBucket(cases, retrieve, k = 5) {
  const rows = cases.map((c) => {
    const retrieved = retrieve(c.query);
    return {
      ...c,
      retrieved,
      p: precisionAtK(retrieved, c.expected, k),
      r: recallAtK(retrieved, c.expected, k),
      h1: hitAt1(retrieved, c.expected),
      rr: reciprocalRank(retrieved, c.expected),
    };
  });
  return {
    n: rows.length,
    precisionAtK: mean(rows.map((x) => x.p)),
    recallAtK: mean(rows.map((x) => x.r)),
    hitAt1: mean(rows.map((x) => x.h1)),
    mrr: mean(rows.map((x) => x.rr)),
    rows,
  };
}

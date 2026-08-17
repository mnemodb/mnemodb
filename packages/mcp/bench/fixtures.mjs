/**
 * Labeled retrieval fixtures over the dogfood store (fixtures/dogfood/).
 *
 * Each case: { kind, query, expected }. `expected` is the set of LIVE entry ids
 * a good ranker should surface in the top results for that query. Cases are
 * bucketed by kind so the report shows *where* retrieval is strong vs weak:
 *
 *  - exact      : query shares surface tokens with the target — keyword recall
 *                 should nail these; they are the regression floor.
 *  - paraphrase : same intent, few/no shared tokens — keyword recall is expected
 *                 to struggle here. This bucket is the measured case FOR semantic
 *                 search: the gap between exact and paraphrase is the motivation.
 *  - multiterm  : one query, several relevant entries.
 *  - negative   : nothing in the store is relevant — a good ranker returns
 *                 nothing (no spurious high-confidence hit).
 *
 * Superseded entries (a0f1, l1cx, r3po) are intentionally never `expected` —
 * recall must not return them.
 */
export const CASES = [
  // --- exact / keyword overlap ---
  { kind: 'exact', query: 'which license did we choose', expected: ['lcns'] },
  { kind: 'exact', query: 'monorepo or multiple repositories', expected: ['mono'] },
  { kind: 'exact', query: 'what is the project named', expected: ['n4m1'] },
  { kind: 'exact', query: 'first integration target', expected: ['c1cd'] },
  { kind: 'exact', query: 'npm package published', expected: ['p0b1'] },
  { kind: 'exact', query: 'engramdb sqlite embeddings', expected: ['e9db'] },
  { kind: 'exact', query: 'memvault postgres prisma', expected: ['m9vt'] },
  { kind: 'exact', query: 'typescript rust core', expected: ['t5l4'] },
  { kind: 'exact', query: 'how does Zivuch like recommendations', expected: ['z1go'] },

  // --- paraphrase: intent matches, few/no shared surface tokens ---
  { kind: 'paraphrase', query: 'how are our source code and specification licensed', expected: ['lcns'] },
  { kind: 'paraphrase', query: 'do we keep everything in a single repository', expected: ['mono'] },
  { kind: 'paraphrase', query: 'which programming language are we building in', expected: ['t5l4'] },
  { kind: 'paraphrase', query: 'do rival products hide how they store data', expected: ['g4p1'] },
  { kind: 'paraphrase', query: 'how should I hand over finished work', expected: ['z2dc'] },

  // --- multi-term / multi-answer ---
  { kind: 'multiterm', query: 'competitor memory storage opaque engine', expected: ['g4p1', 'e9db', 'm9vt'] },
  { kind: 'multiterm', query: 'security injection untrusted provenance flag', expected: ['l66g9ts5', '88rjf8go'] },
  { kind: 'multiterm', query: 'windows crlf carriage return parser', expected: ['4jhtijfm'] },

  // --- negatives: nothing relevant is in the store ---
  { kind: 'negative', query: 'best pizza topping for a party', expected: [] },
  { kind: 'negative', query: 'tomorrow weather forecast rain', expected: [] },
];

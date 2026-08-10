/** @mnemodb/core — types for the MnemoDB agent memory format (spec v0.1). */

export type Conf = 'high' | 'med' | 'low';
export type Pin = 'always' | 'auto' | 'cold';
export type Src = 'user' | 'agent' | 'tool';

/** Registered entry types (spec §5.2). Unknown types are preserved. */
export const REGISTERED_TYPES = [
  'fact', 'pref', 'decision', 'insight', 'episode', 'todo', 'note',
] as const;
export type RegisteredType = (typeof REGISTERED_TYPES)[number];

/** Metadata parsed from the inline-code metadata line (spec §5.3). */
export interface EntryMeta {
  id?: string;
  scope?: string;
  /** 'user' | 'agent' | 'tool', optionally with '/<session-ref>' suffix. */
  src?: string;
  conf?: Conf;
  pin?: Pin;
  /** Duration like '90d', '6m', or 'none'. */
  ttl?: string;
  review?: string;
  updated?: string;
  supersedes?: string[];
  tags?: string[];
  /** Unknown keys are preserved verbatim (spec §12 conformance). */
  extra?: Record<string, string>;
}

export interface Entry {
  /** Entry type: registered or unknown (preserved). 'note' for untyped. */
  type: string;
  /** The heading statement after '<type>: '. */
  statement: string;
  meta: EntryMeta;
  /** Markdown body (may be empty). Excludes heading and metadata line. */
  body: string;
  /** Exact original text of the whole block, for byte-stable round-trip. */
  raw: string;
  /** 1-based line of the '## ' heading in the source file. */
  line: number;
  /** Set when the block was structurally damaged; entry is degraded, not dropped. */
  malformed?: string;
  /** True when raw no longer reflects fields (entry was programmatically edited). */
  dirty?: boolean;
}

export interface FrontMatter {
  mnemo?: string;
  scope?: string;
  title?: string;
  updated?: string;
  budget?: number;
  extra?: Record<string, string>;
}

export interface Diagnostic {
  level: 'error' | 'warn';
  line: number;
  message: string;
  rule: string;
}

/** A parsed .mem.md document. */
export interface MemDoc {
  /** null when the file has no front matter (untyped file). */
  frontMatter: FrontMatter | null;
  /** Exact original front-matter text including delimiters, or null. */
  frontMatterRaw: string | null;
  /** Free prose before the first entry (always-loaded instructions). */
  preamble: string;
  entries: Entry[];
  diagnostics: Diagnostic[];
  /** Source path, when parsed from a file. */
  path?: string;
}

/** Index entry: heading + metadata only, no body (spec §6.1). */
export interface IndexEntry {
  type: string;
  id: string | null;
  statement: string;
  pin: Pin;
  scope: string;
  file: string;
  line: number;
  supersedes: string[];
  tags: string[];
  updated?: string;
  conf: Conf;
}

export const DEFAULT_TTL_DAYS: Record<string, number | null> = {
  episode: 30,
  todo: 90,
  insight: 180,
  note: 180,
  fact: null,
  pref: null,
  decision: null,
};

export const SCOPE_PRECEDENCE = ['episode', 'project', 'user'] as const;

/**
 * Store scaffolding, shared by `mnemo init` and the first `memory_remember`.
 *
 * Before 0.1.21 the two disagreed: `init` built the full layout, while a store
 * born from a first write got only `project.mem.md` — no archive, so
 * compaction had nowhere to move entries and silently did nothing; and no
 * union merge driver, so concurrent branches conflicted on `.mem.md` files.
 * Both paths now create the same files. Raised by the Anthropic plugin
 * directory review (2026-10-13).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STORE_README = `# This is a MnemoDB store

Your agent's memory. Plain Markdown, versioned with your code, safe to read and
hand-edit. This file is documentation only \u2014 MnemoDB loads \`*.mem.md\` and ignores
everything else, so nothing written here reaches the agent's context.

## What each file is for

| File | What lands here | Who writes it |
|---|---|---|
| \`project.mem.md\` | Decisions, facts and preferences about **this project** | \`memory_remember\` (the default) |
| \`user.mem.md\` | Things about **you** that hold across projects | \`memory_remember\`, when the memory is user-scoped |
| \`archive.mem.md\` | Expired and superseded entries \u2014 cold, readable, recoverable | \`memory_compact --write\` |
| \`episodes/\` | Optional session logs (\`type: episode\`) | you, by hand or via \`migrate\` |

## Empty is normal

**\`user.mem.md\` stays empty until you save something user-scoped.** Writes are
routed by *scope*, not by type, and project scope is the default. To put
something here, say so: *"remember, as a personal preference, that I prefer
terse answers."*

**\`episodes/\` is never filled automatically.** Nothing writes to it on its own \u2014
it is for session logs you author, import, or distil yourself. An empty folder
here is the expected state, possibly forever.

**\`archive.mem.md\` stays empty until you compact.** Entries move here when
\`mnemo compact --write\` retires what has expired or been superseded. Nothing is
deleted \u2014 archived entries stay readable and can be brought back.

## Looking around

\`\`\`
npx @mnemodb/cli list        # every memory, one line each
npx @mnemodb/cli doctor      # health: stale, contradictions, budget, damage
npx @mnemodb/cli trace tool  # everything saved from tools (incident response)
\`\`\`

Or just open the files. That is the whole point.

Docs: https://mnemodb.dev
`;

/** Front matter for a scaffolded `.mem.md` file. */
export function storeFrontMatter(scope: string, title: string, date: string): string {
  return `---\nmnemo: "0.1"\nscope: ${scope}\ntitle: "${title}"\nupdated: ${date}\nbudget: 3000\n---\n\n`;
}

export interface ScaffoldOptions {
  /** ISO date (YYYY-MM-DD) stamped into each file's front matter. */
  date: string;
  /**
   * Also write `.gitattributes` (union merge driver, spec §7.3) and
   * `.gitignore` (writer lock) INSIDE the store directory. `mnemo init` leaves
   * this off because it writes those at the project root, where the user asked
   * it to; an automatic first write keeps everything inside `.memory/` rather
   * than editing files the user did not ask it to touch.
   */
  gitFiles?: boolean;
}

/**
 * Create any missing part of a `.memory/` store. Never overwrites: each file is
 * opened with the exclusive flag, so two writers racing to create the same
 * store cannot clobber each other or a file the user already has.
 * Returns the paths (relative to `memoryDir`) it created.
 */
export function scaffoldStore(memoryDir: string, opts: ScaffoldOptions): string[] {
  mkdirSync(join(memoryDir, 'episodes'), { recursive: true });
  const d = opts.date;
  const files: Array<[string, string]> = [
    ['project.mem.md',
      storeFrontMatter('project', 'project memory', d) +
      'Project-level standing instructions go here (always loaded).\n'],
    ['user.mem.md', storeFrontMatter('user', 'user preferences', d)],
    ['archive.mem.md', storeFrontMatter('project', 'archive', d)],
    // Documentation only, deliberately NOT a .mem.md: the loader ignores it.
    ['README.md', STORE_README],
    // Git does not track empty directories, so episodes/ would vanish on clone.
    [join('episodes', '.gitkeep'), ''],
  ];
  if (opts.gitFiles) {
    files.push(['.gitattributes', '*.mem.md merge=union\n'], ['.gitignore', '.mnemo-lock/\n']);
  }
  const created: string[] = [];
  for (const [name, content] of files) {
    try {
      writeFileSync(join(memoryDir, name), content, { flag: 'wx' });
      created.push(name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  return created;
}

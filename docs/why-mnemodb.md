# A database your AI agent can read: introducing MnemoDB

Your coding agent forgets everything between sessions. So you keep a `CLAUDE.md`
or an `AGENTS.md` — a plain Markdown file where you write down the things it
should always know. It works, which is exactly why almost everyone does it. But
if you've lived with one for more than a few weeks, you know how it ends: the
file grows, goes stale, contradicts itself, and eventually you're not sure which
lines still matter. There's no way to ask it a question, no record of who wrote
what or when, and no principled way to forget. It's a notebook that only ever
gets longer.

MnemoDB is what happens when you take that notebook seriously and give it the
properties of a database — while keeping every reason the notebook won in the
first place.

## The one idea

Every MnemoDB file is a valid Markdown file. And every existing Markdown memory
file — your current `CLAUDE.md`, untouched — is already a valid MnemoDB file. You
adopt it by renaming nothing and migrating nothing; structure gets added one
entry at a time, only where you want it.

A structured memory is just a Markdown heading with a one-line metadata span:

```markdown
## decision: We use PostgreSQL LISTEN/NOTIFY for cache invalidation, not Redis
`mnemo c4d1 | src: user | conf: high | supersedes: 99e0`

Redis was dropped to cut infra count. Revisit if we exceed ~500 notifications/s.
```

That's it. It renders fine in any Markdown viewer, it diffs cleanly in git, you
can hand-edit it in any editor — and a program can read every field with no
ambiguity. The heading is the memory; the metadata carries its identity,
provenance, confidence, and lifecycle; the body holds the evidence, loaded only
when needed.

## What the structure buys you

Because each memory is a typed, addressable block, the things a plain file can't
do become easy. An agent can **query** the store — load just the build
preferences, or only the high-priority entries — instead of re-reading the whole
thing. Every memory carries **provenance**: did this come from you, from the
agent, or from some tool's output? That difference turns out to matter enormously
(more on that below). Memories have a **lifecycle** — a time-to-live, a review
date — so the store can be **compacted**: expired notes get archived, and the
useful content of old sessions gets distilled into durable facts, the way the
lesson of a conversation outlives its transcript. And when two agents, or you and
an agent, or two git branches write at once, a **deterministic merge** guarantees
they converge instead of clobbering each other.

None of this requires a server, a database daemon, or a cloud account. A MnemoDB
store is just files in a folder, versioned in the same git repo as your code.
Think SQLite, not Postgres: the store is embedded, the file is the source of
truth, and you can open it and read it with your own eyes. That last property is
not a nicety — it's the whole thesis. A memory system you can't audit is a memory
system you can't trust.

## Why "you can read it" is a security feature

Here is a problem every agent memory system has, and most don't talk about: a
memory is a standing instruction. Whatever gets written into it fires in every
future session. So if an attacker can get text into your agent's memory — say,
prompt-injection text hidden in a web page your agent scrapes — they've planted
an instruction that executes tomorrow, and next week, invisibly.

MnemoDB treats this as a first-class concern. Every memory records where it came
from, and the trust ordering is explicit: what you said outranks what the agent
inferred, which outranks what a tool returned. Tool-sourced content is data,
never instructions. The retrieval API hands the agent each memory's provenance
and an `untrusted` flag so it can actually apply that rule, a lower-trust entry
is forbidden from superseding a higher-trust one, and everything written through
the engine is sanitized so no crafted text can forge a trusted, pinned memory.
Because the store is human-readable and git-versioned, the ultimate backstop is
that you can *look*: every memory, and every change to it, is right there in a
diff. Opaque databases can't offer that.

We know these defenses hold because we attacked them. Before the first public
release, MnemoDB went through an adversarial audit — structural injection, trust
bypass, unicode spoofing, resource exhaustion, the works — and the exploitable
findings became a permanent security test suite that runs before every single
publish. The project's own development history, bugs and fixes included, is
stored in MnemoDB.

## It's infrastructure, not a walled garden

MnemoDB doesn't want to be your agent's brain. It wants to be the file format
that brains write to. The retrieval engine ships as an MCP server, so it plugs
into Claude Code, Cursor, and any MCP client, but the format is the point:
someone else's smarter memory engine can index the same files, and the
conventions people are already inventing by hand — domain glossaries, learning
records, session hand-off documents — all map onto MnemoDB entry types. The goal
is the boring, stable, universal layer underneath, so your agent's accumulated
knowledge is yours, portable, and outlives whatever tool you're using this month.

## Try it

If you use Claude Code:

```
claude mcp add mnemodb -- npx -y @mnemodb/mcp
```

Or start a store by hand and look at what it creates:

```
npx @mnemodb/cli init
```

Point it at your existing `CLAUDE.md` and it just works — everything you've
already written becomes the always-loaded preamble, and new memories accrete as
structured entries below it. The spec, the code (Apache-2.0), and the full audit
are open at [github.com/mnemodb/mnemodb](https://github.com/mnemodb/mnemodb).

PDF has been the same idea for thirty-five years: a document you can hand to
anyone and know it'll open. Agent memory deserves the same — a format that
outlives the tool, that a human can read, and that a machine can trust. That's
what MnemoDB is trying to be.

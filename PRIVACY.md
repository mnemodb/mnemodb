# Privacy

MnemoDB is local software: an MCP server, a CLI and a Claude Code plugin that
read and write plain-text files in your project. This page covers all of them.

## No service, no telemetry

There is no MnemoDB server or account. MnemoDB collects no analytics, sends no
telemetry and makes no network requests of its own.

## What is stored, and where

Memories are plain-text `.mem.md` files in the `.memory/` folder of your
project, on your own disk. They hold whatever you or your agent choose to save,
which can include personal data such as names or email addresses. The files are
not encrypted, so do not store passwords, keys or other secrets in them.

## Where your memories can go

Only through tools you already control:

- **Git.** If you commit `.memory/` and push, it goes wherever your repository
  goes, like any other file in it.
- **Your AI assistant.** When the agent recalls a memory, its text is read into
  the assistant's context, the same as any file the assistant reads. The
  assistant provider's own terms apply to that (for Claude, Anthropic's).
- **Installing.** The plugin starts the server with `npx`, which downloads the
  `@mnemodb/mcp` package from the npm registry. That is an ordinary package
  download; none of your memories are sent.

## Retention and deletion

MnemoDB keeps nothing anywhere except those files. You can read, edit or delete
them at any time; `memory_forget` retires an entry. If you committed them, Git
history keeps earlier versions until you rewrite that history.

## Contact

Questions or concerns: <https://github.com/mnemodb/mnemodb/issues>

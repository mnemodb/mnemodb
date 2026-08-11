/**
 * Plugin ship-gate. The plugin runs a shell hook on the user's machine at
 * session start, so it is the repo's most security-sensitive artifact. These
 * tests run in CI and must stay green before the plugin is published to a
 * marketplace. (They do NOT replace `claude plugin validate` + a real install
 * test in Claude Code — those are the human-side gate.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // plugin/
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

test('all plugin JSON manifests parse', () => {
  json(`${ROOT}.claude-plugin/plugin.json`);
  json(`${ROOT}.mcp.json`);
  json(`${ROOT}hooks/hooks.json`);
  json(`${REPO}/.claude-plugin/marketplace.json`);
});

test('plugin declares only expected surfaces (no excess capability)', () => {
  const p = json(`${ROOT}.claude-plugin/plugin.json`);
  const surfaces = Object.keys(p).filter((k) =>
    ['mcpServers', 'skills', 'hooks', 'commands', 'agents', 'userConfig', 'channels', 'lspServers'].includes(k));
  assert.deepEqual(surfaces.sort(), ['hooks', 'mcpServers', 'skills']);
  assert.ok(!('userConfig' in p), 'no credential prompts');
  assert.ok(!('channels' in p), 'no messaging channels');
});

test('the MCP server runs only the published, audited package', () => {
  const m = json(`${ROOT}.mcp.json`).mcpServers;
  assert.deepEqual(Object.keys(m), ['mnemodb']);
  assert.equal(m.mnemodb.command, 'npx');
  assert.deepEqual(m.mnemodb.args, ['-y', '@mnemodb/mcp']);
});

test('the MCP server pins the store to the project dir (not the launch cwd)', () => {
  // An MCP server's process.cwd() is NOT guaranteed to be the project root, so
  // the plugin must pin MNEMO_STORE to ${CLAUDE_PROJECT_DIR}. Without this, a
  // stray cwd sends memory_remember writes to a store the user's `mnemo list`
  // never reads — the "wrote memory, list is empty" failure.
  const s = json(`${ROOT}.mcp.json`).mcpServers.mnemodb;
  assert.equal(s.env?.MNEMO_STORE, '${CLAUDE_PROJECT_DIR}');
});

test('the skill and hook steer the model to MnemoDB over built-in memory', () => {
  // The field failure was the model using Claude Code's auto-memory instead of
  // calling memory_remember. Both surfaces must explicitly claim the memory
  // system, or nothing lands in the .mem.md store.
  const skill = read(`${ROOT}skills/agent-memory/SKILL.md`);
  const hook = read(`${ROOT}scripts/session-start.sh`);
  for (const [name, txt] of [['skill', skill], ['hook', hook]]) {
    assert.match(txt, /(instead of|in place of) any built-in or automatic memory/i,
      `${name} must tell the model to use MnemoDB instead of built-in memory`);
  }
});

test('SECURITY: the session-start hook script contains no dangerous operations', () => {
  const script = read(`${ROOT}scripts/session-start.sh`);
  // No network, eval, writes, deletes, subshells, or reads from input.
  const forbidden = /\b(curl|wget|nc|ssh|scp|eval|source|rm|mv|cp|dd|chmod|chown|sudo|base64|python|node|read)\b|https?:\/\/|\$\(|`|>>?\s|\/dev\/tcp/;
  assert.ok(!forbidden.test(script), 'hook script must be a static emitter with no side effects');
});

test('SECURITY: the hook emits well-formed SessionStart JSON and nothing else', () => {
  const out = execFileSync('bash', [`${ROOT}scripts/session-start.sh`], { encoding: 'utf8' });
  const parsed = JSON.parse(out); // throws if it emits anything but one JSON object
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string');
  assert.ok(parsed.hookSpecificOutput.additionalContext.length < 2000, 'context stays small');
});

test('SECURITY: no secrets or credentials anywhere in the plugin', () => {
  for (const f of [
    `${ROOT}.claude-plugin/plugin.json`, `${ROOT}.mcp.json`,
    `${ROOT}hooks/hooks.json`, `${ROOT}scripts/session-start.sh`,
    `${ROOT}skills/agent-memory/SKILL.md`, `${REPO}/.claude-plugin/marketplace.json`,
  ]) {
    assert.ok(!/(token|secret|password|api[_-]?key|BEGIN (RSA|OPENSSH|PRIVATE))/i.test(read(f)),
      `no secret-like content in ${f}`);
  }
});

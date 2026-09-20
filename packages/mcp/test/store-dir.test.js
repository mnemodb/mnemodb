/**
 * MNEMO_STORE resolution (regression: silent store scatter on hosts that do not
 * define CLAUDE_PROJECT_DIR).
 *
 * The plugin passes MNEMO_STORE="${CLAUDE_PROJECT_DIR}". A host that leaves that
 * variable undefined hands the server "" — and the old `env || cwd()` quietly
 * treated that as "unset", creating the store wherever npx happened to start.
 * On an ephemeral host the memories are then written, reported as saved, and
 * lost with the sandbox. These tests pin the three cases apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'server.js');

/** Spawn the server in `cwd` with the given MNEMO_STORE and call memory_list. */
function callList(cwd, store) {
  const env = { ...process.env };
  if (store === undefined) delete env.MNEMO_STORE;
  else env.MNEMO_STORE = store;

  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [BUNDLE], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', stderr = '';
    const timer = setTimeout(() => {
      srv.kill();
      reject(new Error('timeout; stderr: ' + stderr.slice(0, 300)));
    }, 20000);
    srv.stderr.on('data', (d) => { stderr += d; });
    srv.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          srv.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 2, method: 'tools/call',
            params: { name: 'memory_list', arguments: {} },
          }) + '\n');
        }
        if (m.id === 2) { clearTimeout(timer); srv.kill(); resolve(m); }
      }
    });
    srv.on('spawn', () => srv.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's', version: '0' } },
    }) + '\n'));
    srv.on('error', reject);
  });
}

/** The JSON-RPC result or error, flattened to a string we can assert on. */
const asText = (m) => JSON.stringify(m);

test('MNEMO_STORE empty: fails loudly and writes nothing', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mnemo-empty-'));
  const m = await callList(cwd, '');
  const out = asText(m);
  assert.match(out, /MNEMO_STORE/, 'the error names the variable');
  assert.match(out, /empty/i, 'the error says it is empty');
  assert.ok(
    !existsSync(join(cwd, '.memory')),
    'must not silently create a store in the working directory',
  );
});

test('MNEMO_STORE whitespace-only: treated the same as empty', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mnemo-blank-'));
  const m = await callList(cwd, '   ');
  assert.match(asText(m), /MNEMO_STORE/);
  assert.ok(!existsSync(join(cwd, '.memory')));
});

test('MNEMO_STORE unexpanded: literal ${...} is rejected, not used as a path', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mnemo-literal-'));
  const m = await callList(cwd, '${CLAUDE_PROJECT_DIR}');
  assert.match(asText(m), /MNEMO_STORE/);
  assert.match(asText(m), /unexpanded/i);
  assert.ok(
    !existsSync(join(cwd, '${CLAUDE_PROJECT_DIR}')),
    'must not create a directory named after the unexpanded variable',
  );
});

test('MNEMO_STORE unset: still falls back to the working directory (unchanged)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mnemo-unset-'));
  const m = await callList(cwd, undefined);
  assert.ok(!m.error, 'unset must keep working — this is the documented fallback');
});

test('MNEMO_STORE valid path: unchanged behaviour', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-valid-'));
  const cwd = mkdtempSync(join(tmpdir(), 'mnemo-valid-cwd-'));
  const m = await callList(cwd, dir);
  assert.ok(!m.error, 'a real path must still resolve');
});

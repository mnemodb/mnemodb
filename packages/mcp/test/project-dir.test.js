/**
 * Store resolution without MNEMO_STORE (0.1.22).
 *
 * The plugin used to pass MNEMO_STORE="${CLAUDE_PROJECT_DIR}". The directory
 * validator now refuses any variable other than ${CLAUDE_PLUGIN_ROOT} in a
 * plugin's commands, so the server reads CLAUDE_PROJECT_DIR itself (Claude
 * Code sets it for the stdio servers it launches), and the plugin passes
 * --require-project-dir so that a host which provides no project directory is
 * an error, never a silent store in the wrong place (the 0.1.19 guarantee).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'server.js');
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

/** Start the server in `cwd` with `envOverrides` and `args`, save one memory. */
function remember(cwd, envOverrides, args = []) {
  const env = { ...process.env };
  delete env.MNEMO_STORE;
  delete env.CLAUDE_PROJECT_DIR;
  for (const [k, v] of Object.entries(envOverrides)) env[k] = v;
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [BUNDLE, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', stderr = '';
    const timer = setTimeout(() => { srv.kill(); reject(new Error('timeout; ' + stderr.slice(0, 300))); }, 20000);
    srv.stderr.on('data', (d) => { stderr += d; });
    srv.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
            params: { name: 'memory_remember', arguments: { statement: 'Probe memory for store resolution' } } }) + '\n');
        }
        if (m.id === 2) { clearTimeout(timer); srv.kill(); resolve(JSON.stringify(m)); }
      }
    });
    srv.on('spawn', () => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '0' } } }) + '\n'));
    srv.on('error', reject);
  });
}
const stored = (dir) => existsSync(join(dir, '.memory', 'project.mem.md'))
  && /Probe memory/.test(readFileSync(join(dir, '.memory', 'project.mem.md'), 'utf8'));

test('CLAUDE_PROJECT_DIR is used when MNEMO_STORE is unset', async () => {
  const cwd = tmp('pd-cwd-'), project = tmp('pd-proj-');
  await remember(cwd, { CLAUDE_PROJECT_DIR: project });
  assert.ok(stored(project), 'store lands in the project directory');
  assert.ok(!existsSync(join(cwd, '.memory')), 'not in the working directory');
});

test('MNEMO_STORE still wins over CLAUDE_PROJECT_DIR', async () => {
  const cwd = tmp('pd-cwd-'), project = tmp('pd-proj-'), explicit = tmp('pd-store-');
  await remember(cwd, { CLAUDE_PROJECT_DIR: project, MNEMO_STORE: explicit });
  assert.ok(stored(explicit));
  assert.ok(!existsSync(join(project, '.memory')));
});

test('--require-project-dir with CLAUDE_PROJECT_DIR set works normally', async () => {
  const cwd = tmp('pd-cwd-'), project = tmp('pd-proj-');
  await remember(cwd, { CLAUDE_PROJECT_DIR: project }, ['--require-project-dir']);
  assert.ok(stored(project));
});

test('--require-project-dir with no project directory fails loudly and writes nothing', async () => {
  const cwd = tmp('pd-cwd-');
  const out = await remember(cwd, {}, ['--require-project-dir']);
  assert.match(out, /CLAUDE_PROJECT_DIR/, 'the error names the missing variable');
  assert.match(out, /MNEMO_STORE/, 'and the way to fix it');
  assert.ok(!existsSync(join(cwd, '.memory')), 'no store scattered into the working directory');
});

test('--require-project-dir treats an empty or unexpanded CLAUDE_PROJECT_DIR as missing', async () => {
  for (const bad of ['', '   ', '${CLAUDE_PROJECT_DIR}']) {
    const cwd = tmp('pd-cwd-');
    const out = await remember(cwd, { CLAUDE_PROJECT_DIR: bad }, ['--require-project-dir']);
    assert.match(out, /No project directory/, `refused for ${JSON.stringify(bad)}`);
    assert.ok(!existsSync(join(cwd, '.memory')));
  }
});

test('without the flag, no project directory still falls back to the working directory', async () => {
  const cwd = tmp('pd-cwd-');
  await remember(cwd, {});
  assert.ok(stored(cwd), 'documented fallback for manual installs is unchanged');
});

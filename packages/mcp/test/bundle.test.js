/**
 * Guards the zero-dependency bundle (the fix for slow npx cold-start / MCP
 * startup timeouts). If a change reintroduces a runtime dependency or breaks the
 * self-contained bundle, these fail before publish.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'server.js');
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

test('bundle: @mnemodb/mcp ships zero runtime dependencies', () => {
  const deps = Object.keys(PKG.dependencies ?? {});
  assert.deepEqual(deps, [], `expected no runtime deps, got: ${deps.join(', ')}`);
  assert.ok(PKG.files.includes('dist/server.js'), 'ships the bundled server');
});

test('bundle: server runs standalone (no node_modules) and answers a tool call', async () => {
  // Reproduce the published layout: a dir with just the bundle + type:module,
  // and NO node_modules — exactly what `npx @mnemodb/mcp` unpacks and runs.
  const dir = mkdtempSync(join(tmpdir(), 'mcp-bundle-'));
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'standalone', type: 'module', version: '0.0.0' }));
  copyFileSync(BUNDLE, join(dir, 'dist', 'server.js'));

  const ok = await new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [join(dir, 'dist', 'server.js')],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MNEMO_STORE: dir } });
    let buf = '', stderr = '';
    const timer = setTimeout(() => { srv.kill(); reject(new Error('timeout; stderr: ' + stderr.slice(0, 300))); }, 20000);
    srv.stderr.on('data', (d) => { stderr += d; });
    srv.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_list', arguments: {} } }) + '\n');
        if (m.id === 2) { clearTimeout(timer); srv.kill(); resolve(!m.error); }
      }
    });
    srv.on('spawn', () => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's', version: '0' } } }) + '\n'));
    srv.on('error', reject);
  });
  assert.ok(ok, 'initialize + a real tool call succeed with no dependencies installed');
});

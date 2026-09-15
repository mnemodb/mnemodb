#!/usr/bin/env node
/**
 * The gate each package runs from `prepublishOnly`.
 *
 * Why this exists: every package used to run `cd ../.. && npm test`, so a
 * release re-ran the whole build + suite once per package. In CI that is four
 * extra full runs after the workflow has already run the build, the suite and
 * the adversarial security gate explicitly — no extra safety, four times the
 * minutes. Locally it meant a publish could fail for reasons unrelated to the
 * package being published (a missing devDependency, say), which is exactly how
 * the 0.1.12 hand-publish broke.
 *
 * So: in CI, only assert that the artifact about to ship was actually built.
 * Outside CI the suite is the only gate there is, so it runs — but once per
 * publish sweep, not once per package, via a short-lived marker.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(REPO, 'packages', 'mcp', 'dist', 'server.js');
const MARKER = join(tmpdir(), 'mnemodb-prepublish-gate');
const TTL_MS = 15 * 60 * 1000;

if (process.env.CI) {
  // The workflow gates explicitly before it publishes anything; all that is
  // left to check is that the build step actually produced the bundle.
  if (!existsSync(BUNDLE)) {
    console.error('prepublish-gate: packages/mcp/dist/server.js is missing — run `npm run build` before publishing.');
    process.exit(1);
  }
  console.log('prepublish-gate: CI already ran build + suite + security gate; not repeating it.');
  process.exit(0);
}

let fresh = false;
try { fresh = Date.now() - statSync(MARKER).mtimeMs < TTL_MS; } catch { /* no marker yet */ }
if (fresh) {
  console.log('prepublish-gate: suite already passed for this publish sweep; not repeating it.');
  process.exit(0);
}

console.log('prepublish-gate: running the full suite before publishing…');
runNpmTest();
writeFileSync(MARKER, new Date().toISOString());

/**
 * Run `npm test` in the repo root, cross-platform.
 *
 * Node >= 18.20.2 / 20.12.2 / 22 refuses to spawnSync a `.cmd` shim without a
 * shell (the CVE-2024-27980 hardening), so `execFileSync('npm.cmd', ...)` dies
 * with EINVAL on Windows. npm sets `npm_execpath` to its own JS entry point for
 * lifecycle scripts, so the portable route is to run that with the node binary
 * already executing us — no shim, no shell, no quoting rules. The shell
 * fallback only matters if this is ever run outside an npm lifecycle.
 */
function runNpmTest() {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith('.js')) {
    execFileSync(process.execPath, [cli, 'test'], { cwd: REPO, stdio: 'inherit' });
    return;
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['test'], { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
}

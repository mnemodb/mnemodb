/**
 * Cross-process store lock for read-modify-write operations.
 *
 * Audit finding (2026-08-10): without a lock, concurrent remember() calls
 * from separate processes each read the same base file and the last atomic
 * rename wins — 9 of 10 parallel writes were lost in testing. The lock
 * serializes writers; readers never need it.
 *
 * Implementation: mkdir is atomic on every platform, so the lock is a
 * directory. The holder writes its pid inside; a held lock is broken only when
 * its holder is gone — a dead pid (crashed holder), or, on a networked FS with
 * no readable pid file, an mtime older than STALE_MS. A live-but-slow holder is
 * never broken, so two writers can't run at once (audit M2). An unusable lock
 * path fails fast instead of spinning forever (audit M1).
 */
import { mkdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const STALE_MS = 10_000;
const RETRY_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Is a process with this pid currently alive on this machine? */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } // exists, no permission
}

/**
 * Whether a held lock may be broken: its holder is gone. Prefers pid liveness
 * (a crashed holder is breakable immediately; a live slow holder never is);
 * falls back to mtime staleness only when no pid file is readable. Throws on an
 * unusable lock path so the caller fails fast rather than spinning (audit M1).
 */
function isBreakable(lockDir: string): boolean {
  let st;
  try { st = statSync(lockDir); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true; // vanished — acquire now
    throw e; // unusable path (ENOTDIR/EACCES/…) — fatal
  }
  let pid = NaN;
  try { pid = parseInt(readFileSync(join(lockDir, 'pid'), 'utf8').trim(), 10); }
  catch { /* no/unreadable pid file — fall back to mtime staleness */ }
  if (Number.isInteger(pid) && pid > 0) return !isAlive(pid);
  return Date.now() - st.mtimeMs > STALE_MS;
}

/** Run fn while holding the store's writer lock. Throws after timeoutMs. */
export function withStoreLock<T>(
  storeRoot: string, fn: () => T, opts?: { timeoutMs?: number },
): T {
  const lockDir = join(storeRoot, '.mnemo-lock');
  const deadline = Date.now() + (opts?.timeoutMs ?? 5_000);
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (mkErr) {
      const code = (mkErr as NodeJS.ErrnoException).code;
      if (code && code !== 'EEXIST') {
        // Unusable lock path (ENOTDIR/EACCES/EPERM…) — never retryable (audit M1).
        throw new Error(`Cannot create store lock at ${lockDir}: ${code}`);
      }
      // Lock is held: break it only if the holder is gone (isBreakable throws on
      // an unusable path — fatal — and returns true on a vanished lock).
      if (isBreakable(lockDir)) {
        try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* another broke it first */ }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for store lock: ${lockDir}`);
      }
      sleepSync(RETRY_MS);
    }
  }
  try {
    try { writeFileSync(join(lockDir, 'pid'), String(process.pid)); } catch { /* best effort */ }
    return fn();
  } finally {
    try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* already removed */ }
  }
}

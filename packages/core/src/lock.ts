/**
 * Cross-process store lock for read-modify-write operations.
 *
 * Audit finding (2026-08-10): without a lock, concurrent remember() calls
 * from separate processes each read the same base file and the last atomic
 * rename wins — 9 of 10 parallel writes were lost in testing. The lock
 * serializes writers; readers never need it.
 *
 * Implementation: mkdir is atomic on every platform, so the lock is a
 * directory. Stale locks (crashed holder) are broken after STALE_MS.
 */
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STALE_MS = 10_000;
const RETRY_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
    } catch {
      try {
        const st = statSync(lockDir);
        if (Date.now() - st.mtimeMs > STALE_MS) {
          try { rmdirSync(lockDir); } catch { /* another process broke it first */ }
          continue;
        }
      } catch { continue; /* lock vanished between mkdir and stat — retry */ }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for store lock: ${lockDir}`);
      }
      sleepSync(RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try { rmdirSync(lockDir); } catch { /* already removed */ }
  }
}

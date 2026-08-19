/**
 * Bundle the MCP server into a single self-contained file.
 *
 * Published as a ZERO-dependency package: `npx @mnemodb/mcp` then downloads one
 * small tarball instead of the whole @modelcontextprotocol/sdk + zod + core
 * dependency tree, so the server cold-starts in ~100ms instead of ~10s+ — which
 * is what was blowing past Claude Code's MCP startup timeout (MCP_TIMEOUT) and
 * leaving the plugin server unconnected at launch.
 *
 * Runs after `tsc` (which still type-checks and emits dist/*.js for the tests);
 * this overwrites dist/server.js with the bundle that ships.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, 'src/server.ts')],
  outfile: join(here, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  legalComments: 'none',
  // esbuild preserves the entry file's shebang; node builtins stay external.
});

console.log('bundled packages/mcp/dist/server.js (zero-dependency)');

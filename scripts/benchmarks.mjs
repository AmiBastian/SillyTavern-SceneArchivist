import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep the first foundation snapshot reproducible alongside the new comparison.
for (const script of ['benchmark.mjs', 'benchmark-lists.mjs', 'benchmark-sources.mjs']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

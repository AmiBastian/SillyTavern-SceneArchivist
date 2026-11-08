import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
import * as M from '../memory-engine.js';

const report = { node: process.version, cpu: cpus()[0]?.model || 'unknown', scope: 'Local saved-record lexical search only; no browser, provider, embeddings or save timing.', runs: [] };
for (const size of [1000, 10000]) {
    const entries = Array.from({ length: size }, (_, index) => ({ content: `Scene ${index}: Ari counted linen in the east store and checked the ledger. ${index % 97 === 0 ? 'Mara left the brass key under the blue teapot, unconfirmed.' : ''}`,
        key: [], sceneArchivist: { id: String(index), storyId: 'scale', type: 'unit', status: 'current', unit: { number: index } } }));
    M.clearSearchCache();
    const heapBefore = process.memoryUsage().heapUsed, start = performance.now();
    const first = M.search(entries, 'brass key teapot');
    const coldMs = performance.now() - start, warm = [];
    for (let run = 0; run < 5; run++) {
        const begin = performance.now();
        const result = M.search(entries, 'brass key teapot');
        if (result.length !== first.length) throw new Error('Search changed while measuring cached lookup.');
        warm.push(performance.now() - begin);
    }
    report.runs.push({ records: size, matches: first.length, coldMs: Math.round(coldMs), warmMedianMs: Math.round(warm.sort((a, b) => a - b)[2]),
        heapGrowthMiB: Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024 * 10) / 10 });
}
if (process.argv.includes('--write')) await writeFile(new URL('../benchmarks/performance.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

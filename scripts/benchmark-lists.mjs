import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { evaluateLists } from '../benchmarks/evaluate-lists.mjs';

const root = new URL('../', import.meta.url);
const fixtureText = await readFile(new URL('benchmarks/fixtures/memory-lists.json', root), 'utf8');
const fixture = JSON.parse(fixtureText);
const hash = value => createHash('sha256').update(value).digest('hex');
const engine = await Promise.all(['memory-retrieval.js', 'memory-provenance.js', 'memory-engine.js', 'core.js', 'token-estimate.js', 'benchmarks/evaluate-lists.mjs', 'scripts/benchmark-lists.mjs']
    .map(path => readFile(new URL(path, root), 'utf8')));
const report = { schema: 1, scope: 'Whole saved records versus complete list excerpts on identical manually labeled memories; no model calls.',
    fixtureHash: hash(fixtureText), engineHash: hash(engine.join('\n')), cases: [] };
for (const noise of [0, 128]) for (const budget of [512, 2048]) for (const mode of ['whole', 'excerpts']) report.cases.push(evaluateLists(fixture, { noise, budget, mode }));
const path = new URL('benchmarks/memory-lists-baseline.json', root);
if (process.argv.includes('--write')) await writeFile(path, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--check')) {
    if (!isDeepStrictEqual(report, JSON.parse(await readFile(path, 'utf8')))) throw new Error('Memory-list retrieval changed. Review per-query differences before recording the intended snapshot.');
}
for (const run of report.cases) console.log(`Lists/${run.mode}: ${run.records} records, ${run.budget} tokens: candidate hit ${(run.candidateHitAt5 * 100).toFixed(1)}%, loaded hit ${(run.loadedHit * 100).toFixed(1)}%, loaded recall ${(run.loadedRecall * 100).toFixed(1)}%; ${run.unknownWithLoaded}/${run.unknownQuestions} unknown questions loaded candidates.`);
console.log('The list comparison measures delivered evidence coverage, not correct answers, extraction, semantic recall or normal World Info injection.');

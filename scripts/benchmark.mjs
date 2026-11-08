import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { evaluateRecall } from '../benchmarks/evaluate.mjs';

const root = new URL('../', import.meta.url);
const fixtureText = await readFile(new URL('benchmarks/fixtures/ember-station.json', root), 'utf8');
const fixture = JSON.parse(fixtureText);
const hash = value => createHash('sha256').update(value).digest('hex');
const engine = await Promise.all(['memory-engine.js', 'token-estimate.js', 'benchmarks/evaluate.mjs', 'scripts/benchmark.mjs']
    .map(path => readFile(new URL(path, root), 'utf8')));
const report = { schema: 1, scope: 'Offline saved-record lexical candidates and budget packing; curated memories; no model calls.',
    fixtureHash: hash(fixtureText), engineHash: hash(engine.join('\n')), cases: [] };
for (const noise of [0, 512]) for (const budget of [512, 2048]) report.cases.push(evaluateRecall(fixture, { noise, budget }));
const path = new URL('benchmarks/baseline.json', root);
if (process.argv.includes('--write')) await writeFile(path, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--check')) {
    const baseline = JSON.parse(await readFile(path, 'utf8'));
    if (!isDeepStrictEqual(report, baseline)) throw new Error('Recall results changed. Review the differences and record the intended baseline with npm run benchmark -- --write.');
}
for (const run of report.cases) console.log(`${run.records} records, ${run.budget} tokens: candidate hit ${(run.candidate.hit * 100).toFixed(1)}%, packed hit ${(run.loaded.hit * 100).toFixed(1)}%; ${run.unknownWithCandidates}/${run.unknownQuestions} unknown questions returned candidates.`);
console.log('This benchmark does not measure AI extraction, answer accuracy, vectors, speaker/date filtering, or original-scene fallback.');

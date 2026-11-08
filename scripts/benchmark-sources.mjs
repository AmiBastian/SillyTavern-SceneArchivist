import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { evaluateSources } from '../benchmarks/evaluate-sources.mjs';

const root = new URL('../', import.meta.url), hash = text => createHash('sha256').update(text).digest('hex');
const fixtureText = await readFile(new URL('benchmarks/fixtures/ember-station.json', root), 'utf8');
const rewriteText = await readFile(new URL('benchmarks/fixtures/recall-rewrites.json', root), 'utf8');
const fixture = JSON.parse(fixtureText), rewrites = JSON.parse(rewriteText);
const code = await Promise.all(['memory-retrieval.js', 'memory-provenance.js', 'original-scenes.js', 'core.js', 'memory-engine.js', 'token-estimate.js',
    'benchmarks/evaluate.mjs', 'benchmarks/evaluate-sources.mjs', 'scripts/benchmark-sources.mjs'].map(path => readFile(new URL(path, root), 'utf8')));
const report = { schema: 1, scope: 'Deterministic evidence availability with verified source passages and manually scripted query rewrites. No model-generated query or final answer is evaluated.',
    fixtureHash: hash(fixtureText), rewriteHash: hash(rewriteText), engineHash: hash(code.join('\n')), cases: [] };
for (const noise of [0, 512]) for (const budget of [512, 2048]) for (const mode of ['saved', 'sources', 'scripted-rewrites']) report.cases.push(evaluateSources(fixture, rewrites, { noise, budget, mode }));
const path = new URL('benchmarks/source-recall-baseline.json', root);
if (process.argv.includes('--write')) await writeFile(path, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--check') && !isDeepStrictEqual(report, JSON.parse(await readFile(path, 'utf8')))) throw new Error('Source recall changed; inspect per-query differences before recording an intentional snapshot.');
for (const run of report.cases) console.log(`Sources/${run.mode}: ${run.records} records, ${run.budget} tokens: delivered hit ${(run.loadedHit * 100).toFixed(1)}%, recall ${(run.loadedRecall * 100).toFixed(1)}%; ${run.unknownWithLoaded}/${run.unknownQuestions} unknown questions loaded candidates.`);
console.log('Scripted rewrites test the search path, not model paraphrase quality. Source access is unconditional here; runtime Ask only follows up when needed.');

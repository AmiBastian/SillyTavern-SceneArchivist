import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreSelection, validateFixture, evaluateRecall } from '../benchmarks/evaluate.mjs';
import * as M from '../memory-engine.js';
const fixture = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/ember-station.json', import.meta.url), 'utf8'));

test('archive allocation accepts current evidence and excludes retired records', () => {
    const entry = { content: 'The brass key opened the gate.', key: ['brass key'] };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'fact' }, { id: 'current' });
    const retired = structuredClone(entry); Object.assign(retired.sceneArchivist, { id: 'retired', status: 'superseded' });
    const decision = M.allocate([retired, entry], { query: 'brass key', budget: 100 });
    assert.deepEqual(decision.accepted.map(item => item.id), ['current']);
    assert.equal(decision.omitted.find(item => item.id === 'retired').reason, 'History');
});

test('recall scoring penalizes missed evidence, irrelevant results, and low-ranked hits', () => {
    assert.deepEqual(scoreSelection(['wrong', 'one', 'two'], ['one', 'two']), { hit: 1, recall: 1, precision: 0.666667, reciprocalRank: 0.5 });
    assert.deepEqual(scoreSelection([], ['one']), { hit: 0, recall: 0, precision: 0, reciprocalRank: 0 });
    assert.equal(scoreSelection(['anything'], []), null);
    assert.equal(scoreSelection(['one', 'one'], ['one']).recall, 1);
});

test('the corpus rejects fabricated support and missing relevance labels', () => {
    const bad = structuredClone(fixture); bad.queries[0].relevant = ['invented'];
    assert.throws(() => validateFixture(bad), /missing record/);
    const source = structuredClone(fixture); source.queries[0].support = [999];
    assert.throws(() => validateFixture(source), /source support/);
});

test('the baseline distinguishes finding an oversized memory from fitting it', () => {
    const result = evaluateRecall(fixture, { noise: 512, budget: 512 });
    const boat = result.queries.find(query => query.id === 'boat-exact');
    assert.equal(boat.candidateScore.hit, 1);
    assert.equal(boat.loadedScore.hit, 0);
    assert.ok(result.queries.every(query => query.tokens <= 512));
    assert.equal(result.knownQuestions, 21);
    assert.equal(result.unknownQuestions, 3);
});

test('the baseline records misses without treating a candidate as a correct AI answer', () => {
    const result = evaluateRecall(fixture);
    assert.equal(result.queries.find(query => query.id === 'watch-indirect').candidateScore.hit, 0);
    assert.equal(result.queries.find(query => query.id === 'unknown-person').candidateScore, null);
    assert.ok(result.loaded.hit < 1);
});

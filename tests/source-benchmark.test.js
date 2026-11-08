import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateSources } from '../benchmarks/evaluate-sources.mjs';

const fixture = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/ember-station.json', import.meta.url), 'utf8'));
const rewrites = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/recall-rewrites.json', import.meta.url), 'utf8'));

test('verified source evidence can fit when a whole unstructured saved record cannot', () => {
    const before = structuredClone(fixture);
    const saved = evaluateSources(fixture, rewrites, { mode: 'saved' });
    const sources = evaluateSources(fixture, rewrites, { mode: 'sources' });
    assert.equal(saved.queries.find(query => query.id === 'boat-exact').score.hit, 0);
    assert.equal(sources.queries.find(query => query.id === 'boat-exact').score.hit, 1);
    assert.ok(sources.loadedHit > saved.loadedHit);
    assert.ok(sources.queries.every(query => query.tokens <= 512));
    assert.deepEqual(fixture, before);
});

test('scripted rewrites exercise independent candidates while unknown questions remain unscored', () => {
    const result = evaluateSources(fixture, rewrites, { noise: 512, mode: 'scripted-rewrites' });
    const coffee = result.queries.find(query => query.id === 'coffee-indirect');
    assert.equal(coffee.score.hit, 1);
    assert.deepEqual(coffee.scriptedQueries, rewrites.queries['coffee-indirect']);
    assert.ok(result.queries.filter(query => !query.relevant.length).every(query => query.score === null));
    assert.throws(() => evaluateSources(fixture, { schema: 1, queries: { invented: ['coffee'] } }), /Invalid scripted rewrite/);
});

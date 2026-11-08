import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLists, buildLists, evaluateLists } from '../benchmarks/evaluate-lists.mjs';
import * as M from '../memory-engine.js';

const fixture = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/memory-lists.json', import.meta.url), 'utf8'));

test('the list comparison uses identical saved text with targets beyond the old tool prefix', () => {
    const { entries, labels } = buildLists(fixture);
    const mara = entries.find(entry => M.record(entry).id === 'mara-list');
    assert.ok(M.tokens(mara.content) > 2048);
    assert.ok(mara.content.indexOf('brass key') > 2400);
    const key = labels.get('mara-list').find(span => span.id === 'key');
    assert.equal(key.to - key.from, 1);
    assert.match(mara.content.split('\n').slice(key.from - 1, key.to).join('\n'), /unconfirmed/);
});

test('complete excerpts deliver deep facts under the same cap that rejects whole lists', () => {
    const before = structuredClone(fixture);
    const whole = evaluateLists(fixture, { budget: 512, mode: 'whole' });
    const excerpts = evaluateLists(fixture, { budget: 512, mode: 'excerpts' });
    assert.equal(whole.queries.find(query => query.id === 'boat-direct').loadedScore.hit, 0);
    assert.equal(excerpts.queries.find(query => query.id === 'boat-direct').loadedScore.hit, 1);
    assert.ok(excerpts.loadedHit > whole.loadedHit);
    assert.ok(excerpts.queries.every(query => query.tokens <= 512));
    assert.deepEqual(fixture, before);
});

test('rare topic words keep both required records ahead of common-name filler', () => {
    const result = evaluateLists(fixture, { budget: 512, noise: 128 });
    const multiple = result.queries.find(query => query.id === 'entry-multiple');
    assert.equal(multiple.loadedScore.recall, 1);
    assert.ok(multiple.loadedEvidence.includes('password'));
    assert.ok(multiple.loadedEvidence.includes('gate'));
    assert.equal(result.queries.find(query => query.id === 'warning-too-large').loadedScore.hit, 0);
    assert.equal(result.queries.find(query => query.id === 'prose-too-large').loadedScore.hit, 0);
    assert.equal(result.queries.find(query => query.id === 'watch-indirect').loadedScore.hit, 0);
    assert.equal(result.queries.find(query => query.id === 'unknown-violin').loadedScore, null);
    assert.ok(result.unknownWithLoaded > 0);
});

test('the list fixture rejects missing, repeated and fabricated evidence labels', () => {
    const missing = structuredClone(fixture); missing.queries[0].relevant = ['invented'];
    assert.throws(() => validateLists(missing), /evidence label/);
    const duplicate = structuredClone(fixture); duplicate.records[1].bullets[0].id = 'boat';
    assert.throws(() => validateLists(duplicate), /duplicate evidence label/);
    const unsafe = structuredClone(fixture); unsafe.records[0].routine = Infinity;
    assert.throws(() => validateLists(unsafe), /Invalid memory-list record/);
});

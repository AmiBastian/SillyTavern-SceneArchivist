import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../memory-engine.js';
import * as Core from '../core.js';
import { MemoryIndex } from '../memory-retrieval.js';
import { TokenCounter } from '../token-cache.js';
import { runtimeMemories } from '../runtime-memory.js';
import { readReferenceEntries, fitReferences } from '../reference-context.js';
import { memoryEvidence, mergeMemoryEvidence, bulletEvidence } from '../memory-provenance.js';
import { diagnosticSnapshot, WORKFLOW_PRESETS } from '../release-tools.js';
import { QUALITY_CASES, scoreQualityReply } from '../quality-check.js';

function memory(content, extra = {}) {
    const entry = { content, world: 'Story', uid: 0, key: [], sceneArchivistArchive: 'Story' };
    entry.sceneArchivist = M.makeRecord(entry, { storyId: 'story', type: 'memory' }, { id: 'memory', subject: 'Zelga', ...extra });
    return entry;
}
const heading = '## ► Memories ' + String.fromCharCode(0x2014) + ' Zelga';
const text = `${heading}\n[February 14, 2027 - Day 1]\n${'- A routine crate of linen.\n'.repeat(600)}- The brass key may be inside the teapot.\n  This is unconfirmed.`;
function runtime() {
    const counter = new TokenCounter(value => M.tokens(value));
    return { options: () => ({ preciseDelivery: true }), memoryIndex: new MemoryIndex(), details: new Set(), recallDetails: new Map(),
        countEntries: entries => counter.entries(entries) };
}

test('native-activated long memories deliver a complete dated bullet without mutating the stored list', async () => {
    const parent = memory(text), before = structuredClone(parent), w = runtime();
    const [view] = await runtimeMemories(w, [parent], 'brass key teapot', 400);
    assert.match(view.content, /February 14, 2027[\s\S]*brass key[\s\S]*unconfirmed/);
    assert.doesNotMatch(view.content, /routine crate/);
    assert.equal(M.record(view).id, 'memory');
    assert.equal(view.sceneArchivistDelivery.excerpts.length, 1);
    assert.deepEqual(parent, before);
});

test('semantic-only, protected and explicit full-detail native activations keep their full text', async () => {
    const w = runtime(), semantic = memory('Zelga takes coffee black.');
    assert.equal((await runtimeMemories(w, [semantic], 'her usual beverage', 400))[0], semantic);
    for (const flag of ['exact', 'locked', 'detailed']) {
        const parent = memory(text, { protection: { [flag]: true } });
        assert.equal((await runtimeMemories(w, [parent], 'brass key', 400))[0], parent);
    }
    const parent = memory(text); w.details.add('memory');
    assert.equal((await runtimeMemories(w, [parent], 'brass key', 400))[0], parent);
    w.details.clear(); w.options = () => ({ preciseDelivery: false });
    assert.equal((await runtimeMemories(w, [parent], 'brass key', 400))[0], parent);
});

test('stale helper-selected excerpts cannot override current native text', async () => {
    const w = runtime(), parent = memory(text);
    w.recallDetails.set('memory', w.memoryIndex.search([parent], 'brass key'));
    const changed = { ...parent, content: text.replace('teapot', 'wooden box') };
    const [view] = await runtimeMemories(w, [changed], 'wooden box', 400);
    assert.match(view.content, /wooden box/);
    assert.doesNotMatch(view.content, /teapot/);
});

test('token counts coalesce identical work, respect concurrency, invalidate tokenizers and evict old content', async () => {
    let running = 0, maximum = 0, calls = 0;
    const counter = new TokenCounter(async text => {
        running++; maximum = Math.max(maximum, running); calls++;
        await new Promise(resolve => setTimeout(resolve, 2)); running--; return M.tokens(text);
    }, { concurrency: 3, maxEntries: 2, maxCharacters: 200 });
    const values = await Promise.all(Array.from({ length: 30 }, (_, index) => counter.value('text ' + index % 5, 'a')));
    assert.equal(values.length, 30); assert.equal(calls, 5); assert.ok(maximum <= 3);
    assert.ok(counter.cache.size <= 2); assert.ok(counter.characters <= 200);
    await counter.value('changed', 'a'); const before = calls;
    await counter.value('changed', 'a'); assert.equal(calls, before);
    await counter.value('changed', 'b'); assert.equal(calls, before + 1);
    const fallback = new TokenCounter(async () => { throw Error('offline tokenizer'); });
    assert.equal(await fallback.value('مرحبا بالعالم'), M.tokens('مرحبا بالعالم') + 4);
});

test('reference sizes, explicit fitting and missing selections are checked without cutting or modifying lore', async () => {
    const book = { entries: { 0: { uid: 0, comment: 'Routine', content: 'Linen '.repeat(1000) }, 1: { uid: 1, comment: 'Key', content: 'The brass key opens the gate.' } } };
    const before = structuredClone(book);
    const entries = await readReferenceEntries([{ book: 'Lore', uid: null }, { book: 'Lore', uid: 1 }], async () => book);
    assert.equal(entries.length, 2);
    await assert.rejects(fitReferences(entries, { budget: 100, policy: 'all' }), /separate allowance/);
    const fitted = await fitReferences(entries, { budget: 100, policy: 'relevant', query: 'brass key' });
    assert.equal(fitted.selected.length, 1); assert.equal(fitted.omitted.length, 1); assert.ok(fitted.tokens <= 100);
    assert.match(fitted.text, /brass key opens the gate/); assert.doesNotMatch(fitted.text, /Linen/);
    await assert.rejects(readReferenceEntries([{ book: 'Lore', uid: 9 }], async () => book), /removed/);
    await assert.rejects(readReferenceEntries([{ book: 'Gone' }], async () => null), /unavailable/);
    assert.deepEqual(book, before);
});

test('per-bullet provenance accepts only selected messages and survives native export round trips', () => {
    const chat = [{ name: 'Mira', is_user: true, mes: 'The key is in the teapot.' }];
    const source = M.sourceSnapshot('source', chat, [{ from: 0, to: 0 }]);
    const raw = { characters: [{ name: 'Zelga', memories: [{ text: '[Day 1, February 14, 2027] Zelga was told where the key is.', messages: [0], sourceIds: [], howLearned: 'told' }] }] };
    const proposed = memoryEvidence(raw, { source });
    const parsed = Core.parseMemoryResponse(JSON.stringify(raw));
    assert.equal(parsed[0].memories.length, 1);
    const entry = memory(`${heading}\n[February 14, 2027 - Day 1]\n- Zelga was told where the key is.\n- Other memory.`);
    mergeMemoryEvidence(entry, proposed, ['Zelga']);
    assert.equal(bulletEvidence(entry, `${heading}\n[February 14, 2027 - Day 1]\n- Zelga was told where the key is.`).length, 1);
    const copy = JSON.parse(JSON.stringify(entry));
    assert.deepEqual(M.record(copy).memoryEvidence, proposed);
    const wrong = structuredClone(raw); wrong.characters[0].memories[0].messages = [99];
    assert.throws(() => memoryEvidence(wrong, { source }), /outside the selected/);
    assert.deepEqual(memoryEvidence({ characters: [{ name: 'Zelga', memories: ['Legacy memory without a claim.'] }] }, { source }), []);
    entry.content = entry.content.replace('was told where', 'suspected where');
    assert.equal(bulletEvidence(entry, `${heading}\n[February 14, 2027 - Day 1]\n- Zelga suspected where the key is.`).length, 0);
});

test('damaged memory objects never turn into a saved object-object memory', () => {
    assert.deepEqual(Core.parseMemoryResponse('{"characters":[{"name":"Zelga","memories":[{}]}]}'), []);
});

test('diagnostic exports omit story data, credentials, URLs and profile names by construction', () => {
    const secret = 'PRIVATE-STORY-TEXT sk-secret https://private-proxy.example';
    const w = { entries: [memory(secret)], state: () => ({ job: { kind: secret, status: 'failed', error: secret, cursor: 1, steps: [{}] }, telemetry: { last: { error: secret, profile: secret } } }),
        options: () => ({ budget: 4000, requestBudget: 20000 }), h: { settings: () => ({ sideProfile: secret, lorebook: secret }), context: () => ({}) } };
    const report = JSON.stringify(diagnosticSnapshot(w));
    assert.doesNotMatch(report, /PRIVATE|sk-secret|private-proxy/);
    assert.match(report, /helperProfileSelected/);
    assert.ok(Object.values(WORKFLOW_PRESETS).every(preset => !('prompt' in preset.settings) && !('sideProfile' in preset.settings)));
});

test('search caching invalidates on text, keywords, aliases, dates and identity changes', () => {
    const entry = memory('A normal note.');
    assert.equal(M.search([entry], 'teapot').length, 0);
    entry.content = 'A teapot is on the table.';
    assert.equal(M.search([entry], 'teapot').length, 1);
    entry.key = ['hidden']; assert.equal(M.search([entry], 'hidden').length, 1);
    entry.key = []; assert.equal(M.search([entry], 'hidden').length, 0);
    M.record(entry).aliases = ['Nyx']; assert.equal(M.search([entry], 'Nyx').length, 1);
    M.record(entry).dates = ['2027-03-19']; assert.equal(M.search([entry], '2027-03-19').length, 1);
    M.record(entry).subject = 'Mara'; assert.equal(M.search([entry], 'Mara').length, 1);
    M.clearSearchCache(); assert.equal(M.search([entry], 'Mara').length, 1);
});

test('connection grounding checks fail wrong knowledge, invented unknowns and invalid citation identities', () => {
    for (const sample of QUALITY_CASES) {
        assert.equal(scoreQualityReply(JSON.stringify({ answer: sample.answer, sources: sample.sources }), sample).passed, true);
        assert.equal(scoreQualityReply(JSON.stringify({ answer: (sample.answer + 1) % sample.options.length, sources: sample.sources }), sample).passed, false);
        assert.equal(scoreQualityReply(JSON.stringify({ answer: sample.answer, sources: ['invented'] }), sample).passed, false);
        assert.equal(scoreQualityReply('not JSON', sample).valid, false);
    }
});

test('portable workflows retain new delivery toggles and reject malformed replacements', () => {
    const workflow = M.workflow({ workbench: { preciseDelivery: true, sceneRecall: false } });
    assert.deepEqual(M.validateWorkflow(workflow).workbench, workflow.workbench);
    assert.throws(() => M.validateWorkflow({ workbench: { preciseDelivery: 'yes' } }), /Invalid workflow toggle/);
});

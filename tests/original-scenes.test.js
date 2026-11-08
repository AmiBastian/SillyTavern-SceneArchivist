import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../memory-engine.js';
import { MemoryIndex, evidenceText, packEvidence, recallQueries } from '../memory-retrieval.js';
import { originalScenes, originalCurrent, searchOriginalScenes, SOURCE_LIMITS } from '../original-scenes.js';
import { toolLookup } from '../prompt-inspection.js';
import { groupMemoryReason } from '../chat-workflows.js';
import { flashbackReason } from '../little-things.js';
import { questionAnswer } from '../archive-questions.js';

const chat = () => [
    { name: 'Mara', is_user: true, mes: 'February 14, 2027. Where did you put the brass key?' },
    { name: 'Ari', mes: 'I think it is in the blue teapot. I have not checked, so this is only a suspicion.' },
    { name: 'Mara', is_user: true, mes: 'Then we still need to check it before trusting that location.' },
];
function record(content = 'Mara and Ari discussed the gate.', messages = chat(), extra = {}) {
    const entry = { content, uid: 0, key: [] };
    entry.sceneArchivist = M.makeRecord(entry, { storyId: 'story', type: 'unit',
        source: M.sourceSnapshot('source', messages, [{ from: 0, to: messages.length - 1 }]) }, { id: 'scene', ...extra });
    return entry;
}
const options = messages => ({ chat: messages, sourceId: 'source', storyId: 'story' });

test('original lookup recovers a detail omitted from a summary, with complete exchange and uncertainty', () => {
    const messages = chat(), parent = record(undefined, messages), before = structuredClone(parent);
    assert.deepEqual(new MemoryIndex().search([parent], 'brass key'), []);
    const { rows, report } = originalScenes([parent], options(messages));
    const ranked = searchOriginalScenes(rows, 'brass key');
    const { evidence, used } = packEvidence(ranked, { query: 'brass key', budget: 512 });
    assert.equal(evidence.length, 1);
    assert.ok(used <= 512);
    assert.match(evidenceText(evidence[0]), /Verified original messages #0-#2/);
    assert.match(evidence[0].entry.content, /blue teapot[\s\S]*only a suspicion[\s\S]*still need to check/);
    assert.equal(originalCurrent(evidence[0], 'source', messages), true);
    assert.equal(report.invalid, 0);
    assert.deepEqual(parent, before);
});

test('foreign, edited, swiped, deleted, reordered and partial source receipts never recover old text', () => {
    for (const amend of [
        (parent, messages) => { M.record(parent).source.chatId = 'other-chat'; },
        (parent, messages) => { messages[1].mes = 'The location changed.'; },
        (parent, messages) => { messages[1] = { name: 'Ari', mes: 'Another swipe.' }; },
        (parent, messages) => { messages.splice(1, 1); },
        parent => { M.record(parent).source.ranges[0].messages.reverse(); },
        parent => { M.record(parent).source.ranges[0].messages.pop(); },
        parent => { M.record(parent).source.ranges[0].messages[1] = M.record(parent).source.ranges[0].messages[0]; },
        parent => { M.record(parent).source.ranges[0].to = 99; },
        parent => { M.record(parent).source.ranges[0].from = -1; },
    ]) {
        const messages = chat(), parent = record(undefined, messages);
        amend(parent, messages);
        const result = originalScenes([parent], options(messages));
        assert.equal(result.rows.length, 0);
        assert.ok(result.report.invalid > 0);
    }
});

test('malformed legacy receipts are skipped without crashing an archive question', () => {
    for (const source of [{ ranges: {} }, { ranges: [null] }, { ranges: [{ from: 0, to: 2, messages: [null, null, null] }] }]) {
        const messages = chat(), parent = record(undefined, messages);
        M.record(parent).source = { chatId: 'source', ...source };
        M.record(parent).supplementalSources = {};
        const result = originalScenes([parent], options(messages));
        assert.equal(result.rows.length, 0);
    }
    const messages = chat(), parent = record(undefined, messages, { revisions: {} });
    assert.equal(originalScenes([parent], options(messages)).rows.length, 0);
});

test('a correction vetoes overlapping receipts from other records, including disabled corrected lists', () => {
    const messages = chat(), parent = record(undefined, messages), corrected = record('The key was destroyed.', messages, { id: 'correction',
        authorCorrections: [{ text: 'Retcon: there is no teapot key.' }] });
    corrected.disable = true;
    const result = originalScenes([parent, corrected], options(messages));
    assert.equal(result.rows.length, 0);
    assert.ok(result.report.corrected > 0);
    delete M.record(corrected).authorCorrections;
    M.record(corrected).revisions = [{ content: 'Old claim', reason: 'Custom author correction' }];
    assert.equal(originalScenes([parent, corrected], options(messages)).rows.length, 0);
});

test('active story, disabled, retired, branch and date restrictions apply before original lookup', () => {
    for (const extra of [{ storyId: 'foreign' }, { status: 'superseded' }, { branchDisabledFrom: 'later-branch' }]) {
        const messages = chat(), parent = record(undefined, messages, extra);
        assert.equal(originalScenes([parent], options(messages)).rows.length, 0);
    }
    const messages = chat(), parent = record(undefined, messages, { dates: ['February 20, 2027'] });
    parent.disable = true;
    assert.equal(originalScenes([parent], options(messages)).rows.length, 0);
    parent.disable = false;
    assert.equal(originalScenes([parent], { ...options(messages), scopeReason: entry => flashbackReason(entry, { flashback: '2027-02-14' }) }).rows.length, 0);
});

test('local source caps report limits and never cut an oversized message to manufacture a fitting passage', () => {
    const messages = chat(), parent = record(undefined, messages);
    for (const limits of [{ records: 0 }, { receipts: 0 }, { messages: 1 }, { characters: 10 }]) {
        const result = originalScenes([parent], { ...options(messages), limits: { ...SOURCE_LIMITS, ...limits } });
        assert.equal(result.rows.length, 0);
        assert.equal(result.report.limited, true);
    }
    messages[1].mes += 'Necessary qualification. '.repeat(2000);
    M.record(parent).source = M.sourceSnapshot('source', messages, [{ from: 0, to: 2 }]);
    const rows = searchOriginalScenes(originalScenes([parent], options(messages)).rows, 'brass key');
    assert.equal(packEvidence(rows, { query: 'brass key', budget: 512 }).evidence.length, 0);
});

test('overlapping original passages and repeated source receipts do not waste the evidence allowance', () => {
    const messages = Array.from({ length: 9 }, (_, index) => ({ name: 'Ari', mes: `Crate ${index} contained linen.` }));
    messages[4].mes = 'The brass key was only rumored to be in the teapot.';
    const parent = record(undefined, messages);
    M.record(parent).supplementalSources = [structuredClone(M.record(parent).source)];
    const { rows, report } = originalScenes([parent], options(messages));
    assert.equal(report.messages, 9);
    const ranked = searchOriginalScenes(rows, 'brass key');
    assert.equal(ranked.length, 1);
    assert.match(ranked[0].entry.content, /only rumored/);
    assert.equal(originalCurrent(ranked[0], 'foreign', messages), false);
    M.record(parent).source.ranges = []; M.record(parent).supplementalSources = [];
    assert.equal(originalCurrent(ranked[0], 'source', messages), false);
});

test('source windows containing system messages are excluded as a whole', () => {
    const messages = chat(); messages[1].is_system = true;
    assert.equal(originalScenes([record(undefined, messages)], options(messages)).rows.length, 0);
});

test('related searches preserve literal and independent alternate candidates without treating a rewrite as evidence', () => {
    const key = record('The brass key opened the gate.', [], { id: 'key', source: {} });
    const coffee = record('Mara takes coffee black, without sugar.', [], { id: 'coffee', source: {} });
    const index = new MemoryIndex(), entries = [key, coffee];
    const primary = index.search(entries, 'brass key');
    assert.deepEqual(index.searchMany(entries, 'brass key'), primary);
    const rows = index.searchMany(entries, 'brass key', ['coffee preference', 'silver violin']);
    assert.ok(rows.some(row => M.record(row.entry).id === 'key'));
    assert.ok(rows.some(row => M.record(row.entry).id === 'coffee'));
    assert.ok(rows.every(row => !row.entry.content.includes('silver violin')));
    assert.deepEqual(recallQueries(['', {}, 'the and', 'coffee', 'coffee', 'tea', 'juice', 'water']), ['coffee', 'tea', 'juice']);
    assert.equal(recallQueries(['x'.repeat(1000)])[0].length, 200);
});

test('alternate tool queries cannot widen character or flashback access and never read source transcripts', () => {
    const messages = chat(); messages[1].mes = 'Private raw scene: the vault code is 7349.';
    const own = record('Mara likes coffee black.', messages, { type: 'memory', subject: 'Mara', subjectAvatar: 'mara.png', dates: ['February 14, 2027'] });
    const secret = record('Ari likes tea sweet. Secret code 1234.', messages, { id: 'ari', type: 'memory', subject: 'Ari', subjectAvatar: 'ari.png', dates: ['February 14, 2027'] });
    const future = record('Mara switches to cocoa.', messages, { id: 'future', type: 'memory', subject: 'Mara', subjectAvatar: 'mara.png', dates: ['February 20, 2027'] });
    const group = { speaker: 'mara.png', members: [{ name: 'Mara', avatar: 'mara.png' }, { name: 'Ari', avatar: 'ari.png' }] };
    const scope = entry => groupMemoryReason(M.record(entry), group, true) || flashbackReason(entry, { flashback: '2027-02-14' });
    const rows = toolLookup([own, secret, future], scope, { topic: 'her usual', queries: ['coffee tea cocoa code'] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].parent, own);
    assert.doesNotMatch(rows.map(evidenceText).join('\n'), /7349|1234|cocoa/);
    assert.deepEqual(toolLookup([own], scope, { topic: '', queries: ['coffee'] }), []);
});

test('answer citations must agree with selected evidence and bounded query rewrites', () => {
    const entry = record(), rows = [{ entry, parent: entry }];
    const valid = { answer: 'The note mentions the gate [scene].', sources: ['scene'], needsMore: false, queries: [] };
    const parse = response => questionAnswer(JSON.stringify(response), rows);
    assert.deepEqual(parse(valid), valid);
    for (const response of [
        { ...valid, answer: '' },
        { ...valid, answer: 'An invented claim [not-supplied].' },
        { ...valid, answer: 'The note mentions the gate.' },
        { ...valid, sources: [] },
        { ...valid, needsMore: 'yes' },
        { ...valid, queries: ['a', 'b', 'c', 'd'] },
        { ...valid, queries: ['x'.repeat(201)] },
        { ...valid, queries: [{ answer: 'invented' }] },
    ]) assert.throws(() => parse(response));
});

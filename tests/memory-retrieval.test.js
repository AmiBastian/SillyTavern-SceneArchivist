import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../memory-engine.js';
import * as Core from '../core.js';
import { MemoryIndex, memoryBlocks, evidenceText, packEvidence, toolEvidence } from '../memory-retrieval.js';
import { toolLookup, registerMemoryTools } from '../prompt-inspection.js';
import { groupMemoryReason } from '../chat-workflows.js';
import { flashbackReason } from '../little-things.js';

function memory(content, extra = {}, type = 'memory') {
    const entry = { content, key: ['archive-wide keyword'], world: 'Memories' };
    entry.sceneArchivist = M.makeRecord(entry, { type, storyId: 'story' }, { id: 'mara', subject: 'Mara', ...extra });
    return entry;
}
const heading = '## ► Memories ' + String.fromCharCode(0x2014) + ' Mara';
const date = '[February 14, 2027 - Day 1]';
const small = `${heading}\n\n${date}\n- Mara counted linen.\n- Mara hid the brass key inside the blue teapot.`;

test('deep list recall fits the relevant whole bullet and its date without rewriting the saved list', () => {
    const content = `${heading}\n\n${date}\n${'- Mara counted linen and checked a routine crate.\n'.repeat(1000)}- Mara hid the brass key inside the blue teapot.\n  Only Ari witnessed it.\n  - Bea was absent.\n`;
    const parent = memory(content), before = structuredClone(parent);
    const rows = new MemoryIndex().search([parent], 'brass key teapot');
    assert.equal(rows.length, 1);
    const packed = packEvidence(rows, { query: 'brass key teapot', budget: 200 });
    assert.equal(packed.evidence.length, 1);
    assert.ok(M.tokens(parent.content) > 10000);
    assert.ok(packed.used <= 200);
    const row = packed.evidence[0];
    assert.match(row.entry.content, /February 14, 2027/);
    assert.match(row.entry.content, /Only Ari witnessed it\.[\s\S]*- Bea was absent\./);
    assert.doesNotMatch(row.entry.content, /counted linen/);
    assert.equal(row.excerpt.fromLine, 1004);
    assert.equal(row.excerpt.toLine, 1006);
    assert.deepEqual(row.excerpt.contextLines, [1, 3]);
    assert.match(evidenceText(row), /Saved record mara; lines 1004-1006/);
    assert.deepEqual(parent, before);
});

test('date groups, inline dates, custom units and CRLF text retain the original wording', () => {
    Core.registerUnits(['Voyage']);
    const content = `${heading}\r\n\r\n[February 14, 2027 - Voyage 1]\r\n- The brass key opened the gate.\r\n\r\n[Date: February 15, 2027]\r\n* [Voyage 2, February 15, 2027] The teapot broke.\r\n`;
    const rows = new MemoryIndex().search([memory(content)], 'teapot');
    assert.equal(rows.length, 1);
    assert.match(rows[0].entry.content, /\[Date: February 15, 2027\]/);
    assert.ok(rows[0].entry.content.endsWith('* [Voyage 2, February 15, 2027] The teapot broke.\r'));
    assert.doesNotMatch(rows[0].entry.content, /Voyage 1|brass key/);
    assert.deepEqual(rows[0].excerpt.contextLines, [1, 6]);
    assert.deepEqual(memoryBlocks('- [Day 1] First.\n- [Day 2] Second.').map(block => block.start), [0, 1]);
});

test('ambiguous global prose, headings, code and unused dates conservatively stay whole', () => {
    for (const content of [
        `These are false beliefs.\n${small}`,
        `${small}\nEverything above was a dream.`,
        `${small}\n### Corrections\n- The key was lost.`,
        `${small}\n[Unknown global condition]\n- The key was lost.`,
        `${small}\n[Day 99]`,
        `${small}\n  \u0060\u0060\u0060\n- code-looking bullet`,
        `${heading}\n[Day 1]\n[Day 2]\n- First.\n- Second.`,
        'A legacy prose memory with a brass key.',
    ]) {
        const parent = memory(content), [row] = new MemoryIndex().search([parent], 'key First');
        assert.ok(row);
        assert.equal(row.entry, parent);
        assert.equal(row.excerpt, null);
    }
});

test('only multi-bullet memories without coverage edges are split', () => {
    const index = new MemoryIndex();
    for (const parent of [memory(`${heading}\n${date}\n- One brass key.`), memory(small, {}, 'fact'), memory(small, { covers: ['unit-1'] })]) {
        const [row] = index.search([parent], 'brass key');
        assert.equal(row.entry, parent);
        assert.equal(M.record(row.entry).id, 'mara');
    }
});

test('query-independent excerpt ids are unique, change after edits, and metadata is never stale in the cache', () => {
    const index = new MemoryIndex(), parent = memory(small);
    const first = index.search([parent], 'brass')[0], again = index.search([parent], 'teapot')[0];
    assert.equal(M.record(first.entry).id, M.record(again.entry).id);
    assert.equal(new Set(index.search([parent], '').map(row => M.record(row.entry).id)).size, 2);
    Object.assign(M.record(parent), { knowledge: 'suspects', learnedAt: '2027-02-16', subject: 'Mara changed' });
    M.record(parent).protection.locked = true;
    const cached = index.search([parent], 'teapot')[0];
    assert.equal(M.record(cached.entry).knowledge, 'suspects');
    assert.equal(M.record(cached.entry).learnedAt, '2027-02-16');
    assert.equal(M.record(cached.entry).protection.locked, true);
    assert.equal(M.record(cached.entry).subject, 'Mara changed');
    parent.content = parent.content.replace('blue teapot', 'red teapot');
    const edited = index.search([parent], 'teapot')[0];
    assert.notEqual(M.record(edited.entry).id, M.record(first.entry).id);
    assert.match(edited.entry.content, /red teapot/);
    assert.doesNotMatch(edited.entry.content, /blue teapot/);
});

test('parent scope is enforced before cached fragments are reused', () => {
    const index = new MemoryIndex(), parent = memory(small);
    assert.ok(index.search([parent], 'key').length);
    assert.deepEqual(index.search([parent], 'key', () => 'foreign speaker'), []);
    parent.disable = true;
    assert.deepEqual(index.search([parent], 'key'), []);
    parent.disable = false;
    M.record(parent).status = 'superseded';
    assert.deepEqual(index.search([parent], 'key'), []);
    M.record(parent).status = 'current'; M.record(parent).branchDisabledFrom = 'other-branch';
    assert.deepEqual(index.search([parent], 'key'), []);
});

test('the parse cache is bounded, isolates books and stories, and clears fully', () => {
    const index = new MemoryIndex({ maxRecords: 2, maxCharacters: 10000 });
    for (let i = 0; i < 4; i++) index.search([memory(small, { storyId: String(i) })], 'key');
    assert.equal(index.cache.size, 2);
    assert.ok(index.characters <= 10000);
    const parent = memory(small), other = { ...parent, world: 'Other', content: small.replace('blue teapot', 'black box') };
    assert.match(index.search([parent], 'teapot')[0].entry.content, /blue teapot/);
    assert.match(index.search([other], 'black box')[0].entry.content, /black box/);
    const tiny = new MemoryIndex({ maxCharacters: 10 });
    tiny.search([parent], 'key');
    assert.equal(tiny.cache.size, 0);
    index.clear();
    assert.equal(index.cache.size, 0);
    assert.equal(index.characters, 0);
});

test('list-wide keywords, locations and dates do not make unrelated bullets match', () => {
    const parent = memory(small + '\n[February 20, 2027 - Day 2]\n- Mara visited the violet observatory.', {
        people: ['Ari'], locations: ['Violet Observatory'], dates: ['February 20, 2027'],
    });
    parent.key = ['teapot', 'Violet Observatory', 'archive-wide keyword'];
    const index = new MemoryIndex();
    assert.equal(index.search([parent], 'teapot').length, 1);
    assert.equal(index.search([parent], 'observatory').length, 1);
    assert.equal(index.search([parent], '20').length, 1);
    assert.equal(index.search([parent], 'keyword').length, 0);
    assert.equal(index.search([parent], 'Ari').length, 0);
});

test('recap coverage still prevents paying for both a list excerpt and its recap', () => {
    const parent = memory(small), recap = memory('A recap of the brass key and teapot.', { id: 'recap', covers: ['mara'] }, 'recap');
    const before = structuredClone(recap), rows = new MemoryIndex().search([recap, parent], 'brass key teapot');
    const packed = packEvidence(rows, { query: 'brass key teapot', budget: 500 });
    assert.equal(packed.evidence.length, 1);
    assert.equal(M.record(packed.evidence[0].parent).id, 'mara');
    assert.equal(packed.omitted.find(row => row.id === 'recap').reason, 'details requested instead');
    assert.deepEqual(recap, before);
});

test('packing includes citation wrappers in the allowance and never clips a large bullet', () => {
    const parent = memory(`${small}\n- A colossal key. ${'Long qualifier. '.repeat(1000)}`);
    const rows = new MemoryIndex().search([parent], 'colossal');
    assert.equal(packEvidence(rows, { query: 'colossal', budget: 150 }).evidence.length, 0);
    const [smallRow] = new MemoryIndex().search([memory(small)], 'teapot');
    const exact = M.tokens(evidenceText(smallRow) + '\n') + 4;
    assert.equal(packEvidence([smallRow], { budget: exact - 1 }).evidence.length, 0);
    assert.equal(packEvidence([smallRow], { budget: exact }).used, exact);
    const output = toolEvidence(rows);
    assert.ok(output.length <= 4800);
    assert.match(output, /exceeds the tool allowance/);
    assert.doesNotMatch(output, /Long qualifier|colossal/);
});

test('tool lookup enforces speaker identity and conservative parent flashback dates', () => {
    const own = memory(small, { subjectAvatar: 'mara.png', aliases: ['Mar'] });
    const other = memory(small.replace('blue teapot', 'secret chest'), { id: 'ari', subject: 'Ari', subjectAvatar: 'ari.png' });
    const future = memory(small + '\n[February 20, 2027 - Day 2]\n- A future key.', { id: 'future', subjectAvatar: 'mara.png' });
    const group = { speaker: 'mara.png', members: [{ name: 'Mara', avatar: 'mara.png' }, { name: 'Ari', avatar: 'ari.png' }] };
    const scope = entry => groupMemoryReason(M.record(entry), group, true) || flashbackReason(entry, { flashback: '2027-02-14' });
    const rows = toolLookup([own, other, future], scope, { topic: 'key', character: 'Mar' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].parent, own);
    assert.doesNotMatch(toolEvidence(rows), /secret chest|future key/);
    assert.deepEqual(toolLookup([own, other], scope, { topic: 'key', character: 'Ari' }), []);
});

test('registered recall tools use deep excerpts, respect changing frames and refuse oversized units whole', async () => {
    const tools = new Map(), parent = memory(`${heading}\n${date}\n${'- Routine crate.\n'.repeat(600)}- The brass key is in the teapot.\n  It is only a rumor.`);
    const day = memory('## ► Day 1 ' + String.fromCharCode(0x2014) + ' February 14, 2027\n' + 'Long scene. '.repeat(1000), { id: 'day', unit: { number: 1 } }, 'unit');
    let future = false;
    const w = { entries: [parent, day], generationEpoch: 1, memoryIndex: new MemoryIndex(), identity: () => 'chat',
        memoryScopeReason: () => '', sceneRecall: { reason: () => future ? 'future evidence' : '' },
        options: () => ({ memoryTools: true }), loadBooks: async () => {}, h: {
            context: () => ({ registerFunctionTool: tool => tools.set(tool.name, tool), isToolCallingSupported: () => true }),
            isBusy: () => false, isActive: () => true,
        } };
    registerMemoryTools(w);
    const recall = tools.get('scene_archivist_recall_memory'), open = tools.get('scene_archivist_open_day');
    const output = await recall.action({ topic: 'brass key teapot' });
    assert.match(output, /brass key is in the teapot\.[\s\S]*only a rumor/);
    assert.doesNotMatch(output, /Routine crate/);
    assert.match(output, /February 14, 2027/);
    assert.match(await open.action({ number: 1 }), /exceeds the tool allowance/);
    assert.doesNotMatch(await open.action({ number: 1 }), /Long scene/);
    future = true;
    assert.match(await recall.action({ topic: 'key' }), /No matching active/);
    w.loadBooks = async () => { w.generationEpoch++; };
    assert.match(await recall.action({ topic: 'key' }), /chat or speaker changed/);
});

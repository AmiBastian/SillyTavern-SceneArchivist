import test from 'node:test';
import assert from 'node:assert/strict';
import { isChatRename, resolveEndpoints, rangeControl, setEndpoint, isSkipped, toggleSkipped, groupMemoryReason, saveNativeGroupFilter, prepareNativeGroupFilter } from '../chat-workflows.js';
import { uncoveredArchiveMessages } from '../flow.js';
import { tokens, makeRecord } from '../memory-engine.js';
import { estimateTokens } from '../core.js';
import { PromptInspection, placePromptLayers, registerMemoryTools } from '../prompt-inspection.js';

test('range endpoints follow original message objects through insertions, swipes, reload and deletions', () => {
    let chat = [{ mes: 'Start' }, { mes: 'End', extra: {} }];
    const state = rangeControl({});
    setEndpoint(state, chat, 'from', 0);
    setEndpoint(state, chat, 'to', 1);
    chat.unshift({ mes: 'Inserted' });
    chat[2].extra = { swipe: 1 };
    chat[2].mes = 'Different ending';
    chat = JSON.parse(JSON.stringify(chat));
    assert.deepEqual(resolveEndpoints(state, chat), { from: { index: 1, missing: false }, to: { index: 2, missing: false } });
    chat.splice(1, 1);
    assert.deepEqual(resolveEndpoints(state, chat), { from: { index: null, missing: true }, to: { index: 1, missing: false } });
});

test('skip follows the message and leaves the archive ledger unchanged', () => {
    const chat = [{ mes: 'opening' }, { mes: 'OOC aside' }, { mes: 'closing' }], metadata = {};
    const state = rangeControl(metadata);
    assert.equal(toggleSkipped(state, chat[1]), true);
    chat.shift();
    assert.equal(isSkipped(state, chat[0]), true);
    assert.deepEqual(uncoveredArchiveMessages(chat, metadata).map(message => message.idx), [1]);
    assert.equal(metadata.ranges, undefined);
    assert.equal(toggleSkipped(state, chat[0]), false);
    assert.deepEqual(uncoveredArchiveMessages(chat, metadata).map(message => message.idx), [0, 1]);
});

test('same-integrity native rename and file copy use different outcomes', async () => {
    const check = { previous: 'Original', current: 'New', integrity: 'shared', previousIntegrity: 'shared' };
    assert.equal(await isChatRename({ ...check, listFiles: async () => ['New'] }), true);
    assert.equal(await isChatRename({ ...check, listFiles: async () => ['Original', 'New'] }), false);
    assert.equal(await isChatRename({ ...check, parent: 'Original', listFiles: async () => ['New'] }), false);
    await assert.rejects(isChatRename({ ...check, listFiles: async () => null }), /previous chat name/);
});

test('group memory scope uses card identity and rejects ambiguous names or aliases', () => {
    const members = [{ avatar: 'one.png', name: 'Ari', aliases: ['Ariel'] }, { avatar: 'two.png', name: 'Ari' }, { avatar: 'three.png', name: 'Bea' }];
    const group = { speaker: 'one.png', members };
    const memory = { type: 'memory', subject: 'Ari' };
    assert.match(groupMemoryReason(memory, group, true), /unique/);
    assert.equal(groupMemoryReason({ ...memory, subjectAvatar: 'one.png' }, group, true), '');
    assert.match(groupMemoryReason({ ...memory, subjectAvatar: 'two.png' }, group, true), /another/);
    assert.equal(groupMemoryReason({ ...memory, subject: 'Ariel' }, group, true), '');
    assert.equal(groupMemoryReason(memory, group, false), '');
    assert.equal(groupMemoryReason(memory, null, true), '');
});

test('portable group filters follow the exact card and are removed only from solo or opted-out scans', () => {
    const group = { speaker: 'Ari v2.png', members: [{ avatar: 'Ari v2.png', name: 'Ari' }, { avatar: 'Bea.png', name: 'Bea' }] };
    const entry = { sceneArchivist: { type: 'memory', subject: 'Ari' } };
    saveNativeGroupFilter(entry, group);
    assert.deepEqual(entry.characterFilter, { names: ['Ari v2'], tags: [], isExclude: false });
    assert.equal(entry.sceneArchivist.subjectAvatar, 'Ari v2.png');

    const soloScan = { ...entry }, optOutScan = { ...entry }, renamedScan = { ...entry };
    prepareNativeGroupFilter(soloScan, null, true);
    prepareNativeGroupFilter(optOutScan, group, false);
    prepareNativeGroupFilter(renamedScan, group, true, () => 'Ari final.png');
    assert.equal(soloScan.characterFilter, undefined);
    assert.equal(optOutScan.characterFilter, undefined);
    assert.deepEqual(renamedScan.characterFilter.names, ['Ari final']);
    assert.deepEqual(entry.characterFilter.names, ['Ari v2']);
    saveNativeGroupFilter(entry, { members: [{ avatar: 'Ari final.png', name: 'Ari' }] }, () => 'Ari final.png');
    assert.equal(entry.sceneArchivist.subjectAvatar, 'Ari final.png');
    assert.deepEqual(entry.characterFilter.names, ['Ari final']);
});

test('hand-edited filters, deliberate removals and ambiguous group subjects are preserved', () => {
    const members = [{ avatar: 'one.png', name: 'Ari' }, { avatar: 'two.png', name: 'Ari' }];
    const group = { members };
    const ambiguous = { sceneArchivist: { type: 'memory', subject: 'Ari' } };
    saveNativeGroupFilter(ambiguous, group);
    assert.equal(ambiguous.characterFilter, undefined);

    const manualFilter = { names: ['two'], tags: [], isExclude: true };
    const custom = { sceneArchivist: { type: 'memory', subjectAvatar: 'one.png', nativeGroupCard: 'one' }, characterFilter: manualFilter };
    saveNativeGroupFilter(custom, group);
    prepareNativeGroupFilter(custom, null, false);
    assert.equal(custom.characterFilter, manualFilter);
    delete custom.characterFilter;
    saveNativeGroupFilter(custom, group);
    assert.equal(custom.characterFilter, undefined);
});

test('token fallbacks agree and budget for Arabic and CJK', () => {
    const latin = 'a plain memory about the railway station';
    for (const text of [latin, 'العربية لغة جميلة وأحب الكتابة بها', '雨が降った駅で鍵を受け取りました', '💡 📚 🧠']) {
        assert.equal(tokens(text), estimateTokens(text));
    }
    assert.ok(tokens('المفتاح النحاسي عند البوابة الغربية') > Math.ceil('المفتاح النحاسي عند البوابة الغربية'.length / 3.6) * 2);
    assert.ok(tokens('她把钥匙放在左边的口袋里') >= 12);
});

test('reply traces persist to the active swipe, including a reply with zero loaded memories', () => {
    const entry = { content: 'Brass key', sceneArchivist: { id: 'key' } };
    const chat = [{ mes: 'first reply', extra: {}, swipe_id: 0, swipe_info: [{ extra: {} }, { extra: {} }] }];
    const w = { h: { context: () => ({ chat }), isBusy: () => false, tokenizerKey: () => 'model' },
        identity: () => 'chat', generationEpoch: 1, findRetrievedEntry: entry => entry,
        options: () => ({ cacheLayers: false }), activationReasons: () => ['keyword'],
        sceneRecall: { selection: () => ({ items: [], tokens: 0 }), receive() {} } };
    const trace = new PromptInspection(w);
    trace.begin('normal');
    trace.activated([entry]);
    trace.promptReady({ chat: [{ role: 'system', content: 'Fixed prompt' }] });
    trace.receive(0, 'normal');
    assert.equal(chat[0].swipe_info[0].extra.sceneArchivistPrompt.loaded, 1);
    chat[0].swipe_id = 1;
    chat[0].extra = {};
    w.generationEpoch++;
    trace.begin('swipe');
    trace.promptReady({ chat: [{ role: 'system', content: 'Fixed prompt' }, { role: 'user', content: 'next' }] });
    trace.receive(0, 'swipe');
    assert.equal(chat[0].extra.sceneArchivistPrompt.loaded, 0);
    assert.equal(chat[0].swipe_info[0].extra.sceneArchivistPrompt.active[0].id, 'key');
    assert.ok(chat[0].extra.sceneArchivistPrompt.prefixTokens > 0);
});

test('optional prompt layers keep pinned material early and dynamic matches close to the reply', () => {
    const pinned = { position: 7, sceneArchivist: { protection: { pinned: true } } }, dynamic = { position: 7, depth: 8, role: 1 };
    placePromptLayers(pinned);
    placePromptLayers(dynamic);
    assert.equal(pinned.position, 0);
    assert.equal(pinned.constant, true);
    assert.deepEqual([dynamic.position, dynamic.depth, dynamic.role], [4, 1, 0]);
});

test('recall tools require host support and read only eligible records of the speaking card', async () => {
    const tools = new Map();
    const own = { content: 'Blue key', sceneArchivist: makeRecord({ content: 'Blue key' }, { type: 'memory' }, { subject: 'Ari' }) };
    const foreign = { content: 'Secret blue key', sceneArchivist: makeRecord({ content: 'Secret blue key' }, { type: 'memory' }, { subject: 'Bea' }) };
    const disabled = { ...own, content: 'Hidden blue key', disable: true };
    const day = { content: '## ► Day 1 — February 14, 2027' };
    day.sceneArchivist = makeRecord(day, { type: 'unit' });
    let enabled = false, supported = true;
    const w = { h: {
        context: () => ({ registerFunctionTool: tool => tools.set(tool.name, tool), isToolCallingSupported: () => supported }),
        isBusy: () => false, isActive: () => true,
    }, options: () => ({ memoryTools: enabled }), identity: () => 'chat', loadBooks: async () => {},
    entries: [own, foreign, disabled, day], memoryScopeReason: entry => entry === foreign ? 'belongs to another card' : '' };
    registerMemoryTools(w);
    const recall = tools.get('scene_archivist_recall_memory'), open = tools.get('scene_archivist_open_day');
    assert.equal(recall.shouldRegister(), false);
    enabled = true; supported = false;
    assert.equal(recall.shouldRegister(), false);
    supported = true;
    assert.equal(recall.shouldRegister(), true);
    const answer = await recall.action({ topic: 'blue key' });
    assert.match(answer, /Blue key/);
    assert.doesNotMatch(answer, /Secret|Hidden/);
    assert.match(await open.action({ number: 1 }), /February 14/);
    assert.match(await open.action({ number: '1' }), /non-negative/);
});

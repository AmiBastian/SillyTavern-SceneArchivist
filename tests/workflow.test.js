import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Workbench } from '../workbench.js';
import * as M from '../memory-engine.js';
import * as Core from '../core.js';
import * as Flow from '../flow.js';
import { placeSharedUnits, selectionExport } from '../workflow-tools.js';
import { projectBranch } from '../recovery-tools.js';
import { addLittleThings, littleThings, makeLittleThing } from '../little-things.js';
import { DEFAULT_MEMORY_PROMPT, DEFAULT_SETTINGS, LEGACY_MEMORY_PROMPTS } from '../defaults.js';

function fixture({ existing = {}, failTracker = false, limits = {}, prefs = {}, amendChat = false, noteProposals } = {}) {
    const config = { ...M.copy(DEFAULT_SETTINGS), lorebook: 'Story', memoryBook: 'Memories', sideProfile: 'notes', archiveProfile: 'summary',
        storyBooks: { Story: { Story: 'archive' } }, trackers: [{ id: 'threads', name: 'Threads', enabled: true, prompt: 'Track loose ends.' },
            { id: 'places', name: 'Places', enabled: true, prompt: 'Track places.' }] };
    const metadata = { workbench: { storyId: 'story', originChat: 'Main', flowSettings: prefs, telemetry: { input: 0, output: 0, requests: 0 } } };
    const chat = [{ name: 'Mira', is_user: true, mes: 'I give Zelga the brass key.' }, { name: 'Zelga', mes: 'Zelga thanks Mira at the front gate.' }];
    const identity = { chatId: 'Main', chatMetadata: {} };
    const books = { Story: { entries: {} }, ...M.copy(existing) };
    const calls = [], reviews = [], alerts = [];
    let busy = false, failed = false;
    const host = {
        settings: () => config, meta: () => metadata, context: () => ({ chat, ...identity, name1: 'Mira', getWorldInfoNames: () => Object.keys(books) }),
        load: async name => books[name] ? M.copy(books[name]) : null, save: async (name, data) => { books[name] = M.copy(data); },
        makeEntry: (_name, data) => { const uid = Math.max(-1, ...Object.keys(data.entries).map(Number)) + 1; return data.entries[uid] = { uid }; },
        createBook: async name => { books[name] ??= { entries: {} }; }, own: data => data, register: (archive, book, type) => { (config.storyBooks[archive] ??= {})[book] = type; },
        memoryBook: () => 'Memories', memoryBookFor: () => 'Memories', options: () => ({ delivery: 'depth', keepDays: 3 }),
        begin: () => { if (busy) return false; busy = true; return true; }, end: () => { busy = false; }, isBusy: () => busy,
        saveMeta: async () => {}, saveSettings: () => {}, ensureArchive: async () => true, assert: () => {}, attach: async () => {},
        undoStart: () => {}, snapshot: async () => {}, reload: () => {}, notify: message => alerts.push(message), confirmText: async () => true,
        tokenCount: async text => M.tokens(text), flowModelInfo: id => ({ name: id || 'Current', context: limits[id] || 200000, output: 2000 }),
        readReferences: async refs => refs.length ? 'Zelga is a locksmith.' : '',
        readDiaryLore: async () => 'Attached lore: Zelga is a locksmith.',
        prepareArchive: async (raw, data, source, placement) => {
            const output = Flow.archiveAnswer(raw), parsed = Core.parseArchivistOutput(output.raw);
            if (placement) placeSharedUnits(data, parsed.entries, placement);
            const plan = Core.planChanges(data, parsed, { delivery: 'depth', source, keepDays: 3 });
            plan.adds.forEach((item, i) => { item.keys = output.keywords[i] || ['key']; });
            return { parsed, plan, littleThings: output.littleThings };
        },
        afterArchive: async range => {
            for (const r of range.ranges || [range]) {
                if ((metadata.ranges || []).some(x => x.stepId === range.stepId && x.from === r.from && x.to === r.to)) continue;
                (metadata.ranges ??= []).push({ from: r.from, to: r.to, stepId: range.stepId });
            }
        },
        sendFlowRequest: async (req, profile) => {
            calls.push({ req, profile });
            if (req.prompt.includes('ORIGINAL CHAT MESSAGES')) {
                return req.prompt.includes('Zelga opened the gate.') ? '[February 15, 2027]\nI opened the gate.' : '[February 14, 2027]\nMira gave me the brass key.';
            }
            if (req.prompt.startsWith('SHARED MATERIAL')) return JSON.stringify({ stages: {
                archive: { archive: '## Day 1 — February 14, 2027\n\n- Mira gave Zelga the brass key.', keywords: [['brass key']] },
                memories: { characters: [{ name: 'Zelga', aliases: [], memories: ['Mira gave Zelga a brass key.'] }] },
                trackers: { trackers: [{ id: 'threads', content: '- Return to the gate.' }, { id: 'places', content: '- Front gate.' }] },
            } });
            if (profile === 'summary') return JSON.stringify({ archive: '## Day 1 — February 14, 2027\n\n- Mira gave Zelga the brass key.', keywords: [['brass key']], littleThings: noteProposals });
            if (req.prompt.startsWith('TRACKERS')) {
                if (failTracker && !failed) { failed = true; throw new Error('Connection failed'); }
                if (amendChat) chat[0].mes = 'I handed over the brass key.';
                return JSON.stringify({ trackers: [{ id: 'threads', content: '- Return to the front gate.' }, { id: 'places', content: '- Front gate.' }] });
            }
            return JSON.stringify({ characters: [{ name: 'Zelga', aliases: [], memories: ['[Date: February 14, 2027] Mira gave Zelga a brass key.'] },
                { name: 'Mira', aliases: [], memories: ['[Date: February 14, 2027] Mira handed over the brass key.'] }] });
        },
    };
    const create = () => {
        const workbench = new Workbench(host);
        const review = workbench.review.bind(workbench);
        workbench.review = async (changes, title, note) => {
            if (workbench.bulkRun) return review(changes, title, note);
            reviews.push({ changes: M.copy(changes), title, note });
            return true;
        };
        return workbench;
    };
    return { w: create(), create, config, books, metadata, chat, identity, calls, reviews, alerts };
}

test('helpers migrate the old default and allow large requests within the configured context', async () => {
    const f = fixture();
    f.config.workbench = { requestBudget: 18000, batchSize: 6, charactersPerBatch: 4 };
    assert.deepEqual(f.w.helperCapacity(6000), { input: 194000, output: 6000 });
    assert.equal(f.w.options().batchSize, 0);
    assert.equal(f.w.options().charactersPerBatch, 0);
    const req = { system: 'Read this material.', prompt: 'Story material '.repeat(6500), maxTokens: 6000 };
    const requests = [];
    f.w.h.model = async request => { requests.push(request); return 'Done.'; };
    await f.w.call(req, 'helper');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].maxTokens, 6000);
    f.w.options().requestBudget = 18000;
    await assert.rejects(f.w.call(req, 'helper'), /room for 18000/);
    assert.equal(requests.length, 1);
    assert.equal(M.validateWorkflow(M.workflow(f.config)).workbench.requestBudget, 18000);
    f.w.options().requestBudget = 0;
    f.w.h.flowModelInfo = () => ({ context: 22000, output: 2000 });
    await assert.rejects(f.w.call(req, 'helper'), /room for 16000/);
    assert.equal(requests.length, 1);
});

test('automatic helper grouping replaces the old unit and character counts', async () => {
    const entries = Object.fromEntries(Array.from({ length: 9 }, (_, uid) => {
        const name = 'Character ' + uid;
        const e = { uid, content: `## ► Memories — ${name}\n\n- The brass key opened the front gate.` };
        e.sceneArchivist = M.makeRecord(e, { type: 'memory', storyId: 'story' }, { subject: name });
        return [uid, e];
    }));
    const f = fixture({ existing: { Memories: { entries } } });
    await f.w.loadBooks();
    assert.equal(f.w.chunks(f.w.entries).length, 1);
    const [batch, ...rest] = f.w.auditSteps(f.w.entries);
    assert.equal(rest.length, 0);
    assert.equal(batch.audits.length, 9);
    f.w.options().charactersPerBatch = 4;
    assert.deepEqual(f.w.auditSteps(f.w.entries).map(step => step.ids.length), [4, 4, 1]);
});

test('a chat rename keeps its books while a native branch with copied integrity detaches', async () => {
    const f = fixture();
    f.metadata.workbench.chatIntegrity = 'saved-chat';
    f.identity.chatMetadata.integrity = 'saved-chat';
    f.identity.chatId = 'Renamed';
    await f.w.ensureBranch();
    assert.equal(f.metadata.workbench.originChat, 'Renamed');
    assert.equal(f.config.lorebook, 'Story');
    assert.deepEqual(Object.keys(f.books), ['Story']);
    f.identity.chatId = 'Renamed - Branch #1';
    f.identity.chatMetadata.main_chat = 'Renamed';
    await f.w.ensureBranch();
    assert.equal(f.config.lorebook, 'Story · Branch #1');
    assert.equal(f.metadata.workbench.branchLineage.parent, 'Renamed');
    assert.deepEqual(Object.keys(f.books), ['Story', 'Story · Branch #1']);
});

test('an interrupted branch setup reuses the same book after a rename', async () => {
    const f = fixture();
    f.metadata.workbench.chatIntegrity = 'parent-chat';
    f.identity.chatId = 'Main - Branch #1';
    f.identity.chatMetadata = { integrity: 'branch-chat', main_chat: 'Main' };
    const createBook = f.w.h.createBook;
    f.w.h.createBook = async () => { throw new Error('Write interrupted'); };
    await assert.rejects(f.w.ensureBranch(), /Write interrupted/);
    const destination = f.metadata.workbench.branchIntent.mapping.Story;
    f.identity.chatId = 'Renamed branch';
    f.w.h.createBook = createBook;
    await f.w.ensureBranch();
    assert.equal(f.config.lorebook, destination);
    assert.equal(f.metadata.workbench.originChat, 'Renamed branch');
    assert.deepEqual(Object.keys(f.books), ['Story', destination]);
});

test('the prompt default leaves persona policy to the workflow toggle', () => {
    assert.doesNotMatch(DEFAULT_MEMORY_PROMPT, /Do not write memories for|Scene Log/);
    assert.match(DEFAULT_MEMORY_PROMPT, /supplied roleplay evidence/);
    assert.ok(LEGACY_MEMORY_PROMPTS.some(prompt => prompt.includes('Do not write memories for {{user}}') && prompt.includes('Read the entire excerpt')));
});

test('whole day runs one request per stage and one review with profile routing', async () => {
    const f = fixture({ prefs: { readReferences: true, references: [{ book: 'Lore' }] } });
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(f.calls.map(call => call.profile), ['summary', 'notes', 'notes']);
    assert.equal(f.reviews.length, 1);
    assert.ok(f.calls[0].req.prompt.includes('Zelga is a locksmith.'));
    assert.ok(f.calls[1].req.prompt.includes('Zelga is a locksmith.'));
    assert.equal(f.metadata.ranges[0].to, 1);
    assert.equal(f.metadata.workbench.chatMemoryReceipts.length, 1);
    const memories = Object.values(f.books.Memories.entries);
    assert.equal(memories.length, 1);
    assert.match(memories[0].content, /\[Date: February 14, 2027\]/);
    assert.equal(M.record(memories[0]).source.ranges[0].from, 0);
    assert.equal(Object.values(f.books.Story.entries).filter(e => M.record(e)?.type === 'tracker').length, 2);
});

test('a failed tracker leaves ready results to save and retries only the tracker after reload', async () => {
    const f = fixture({ failTracker: true });
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'failed');
    assert.equal(job.cursor, 2);
    assert.deepEqual(Object.keys(f.books.Story.entries), []);
    await f.w.reviewReady();
    assert.ok(Object.values(f.books.Story.entries).some(e => M.record(e)?.type === 'unit'));
    assert.equal(f.metadata.ranges.length, 1);
    assert.equal(f.metadata.workbench.chatMemoryReceipts.length, 1);
    const reopened = f.create();
    await reopened.withLock(() => reopened.queue.resume());
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(f.calls.map(call => call.profile), ['summary', 'notes', 'notes', 'notes']);
    assert.equal(f.reviews.length, 2);
});

test('declining a suggested Little Thing finishes the run and keeps concurrently saved notes', async () => {
    const f = fixture({ noteProposals: [
        { text: 'Zelga was given a brass key.', cues: ['brass key'], knows: ['Zelga'], message: 0, evidence: 'the brass key' },
        { text: 'An invented gift.', cues: ['gold key'], shared: true, message: 0, evidence: 'the gold key' },
    ] });
    let review = 0;
    const fallback = f.w.review;
    f.w.review = async (changes, title, note) => {
        if (f.w.bulkRun) return fallback(changes, title, note);
        review++;
        const notes = changes.filter(change => change.note);
        assert.equal(notes.length, 1);
        notes[0].include = false;
        addLittleThings(f.books.Story, [makeLittleThing({ text: 'The lantern smelled of pine.', cues: ['pine'] })], 'story');
        return true;
    };
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'done', job.error);
    assert.equal(review, 1);
    assert.deepEqual(littleThings(f.books.Story).map(note => note.text), ['The lantern smelled of pine.']);
    assert.ok(Object.values(f.books.Story.entries).some(entry => M.record(entry)?.type === 'unit'));
    assert.equal(Object.values(f.books.Story.entries).filter(entry => M.record(entry)?.type === 'tracker').length, 2);
    assert.deepEqual(f.calls.map(call => call.profile), ['summary', 'notes', 'notes']);
});

test('Review later retains suggestions and a declined suggestion stays out of a partially saved draft', async () => {
    const f = fixture({ noteProposals: [
        { text: 'Zelga was given a brass key.', cues: ['brass key'], knows: ['Zelga'], message: 0, evidence: 'the brass key' },
    ] });
    const fallback = f.w.review;
    let reviews = 0;
    f.w.review = async (changes, title, note) => {
        if (f.w.bulkRun) return fallback(changes, title, note);
        const suggestion = changes.find(change => change.note);
        assert.ok(suggestion);
        suggestion.include = false;
        if (++reviews === 1) return false;
        changes.find(change => change.section === 'Trackers').include = false;
        return true;
    };
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'paused', job.error);
    assert.equal(littleThings(job.draft.books.Story).length, 1);
    assert.deepEqual(littleThings(f.books.Story), []);
    await f.w.withLock(() => f.w.queue.resume());
    assert.equal(job.status, 'paused', job.error);
    assert.deepEqual(littleThings(job.draft.books.Story), []);
    const reopened = f.create();
    await reopened.withLock(() => reopened.queue.resume());
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(f.calls.map(call => call.profile), ['summary', 'notes', 'notes']);
    assert.deepEqual(f.reviews.at(-1).changes.map(change => change.section), ['Trackers']);
    assert.deepEqual(littleThings(f.books.Story), []);
});

test('condensing a character list keeps its Little Things private to the source character', async () => {
    const entry = { uid: 0, content: '## ► Memories — Zelga\n\n[February 14, 2027 - Day 1]\n- Mira handed Zelga the brass key and Zelga took the key into her own hand.' };
    entry.sceneArchivist = M.makeRecord(entry, { storyId: 'story', type: 'memory' }, { subject: 'Zelga', subjectAvatar: 'zelga.png' });
    const f = fixture({ existing: { Memories: { entries: { 0: entry } } } });
    const id = M.record(entry).id;
    let calls = 0;
    f.w.h.sendFlowRequest = async request => {
        calls++;
        assert.match(request.system, /littleThings/);
        return JSON.stringify({
            entries: [{ id, content: '## ► Memories — Zelga\n\n[February 14, 2027 - Day 1]\n- Mira gave Zelga the brass key.' }],
            littleThings: [{ recordId: id, text: 'Mira gave Zelga the brass key.', cues: ['brass key'], shared: true, evidence: 'Mira handed Zelga the brass key' }],
        });
    };
    await f.w.loadBooks();
    const job = await f.w.startCondense(f.w.entries, false, true);
    assert.equal(job.status, 'done', job.error);
    assert.equal(calls, 1);
    const [saved] = littleThings(f.books.Story);
    assert.deepEqual(saved.knows, ['Zelga']);
    assert.equal(saved.knownAvatar, 'zelga.png');
    assert.equal(saved.recordId, id);
    assert.equal(f.reviews[0].changes.find(change => change.note).section, 'Little Things');
    assert.deepEqual(littleThings(M.parseBundle(M.makeBundle(f.books, f.metadata, f.config)).books.Story), [saved]);
});

test('chat memory works without an archive and persona is independently opt-in', async () => {
    const f = fixture({ prefs: { persona: true } });
    const job = await f.w.startFlow('memories');
    assert.equal(job.status, 'done', job.error);
    assert.equal(f.calls.length, 1);
    assert.equal(Object.keys(f.books.Story.entries).length, 0);
    assert.equal(Object.values(f.books.Memories.entries).length, 2);
    assert.equal(f.calls[0].req.prompt.includes('BACKGROUND REFERENCES'), false);
});

test('edited evidence is flagged in review without blocking the save', async () => {
    const f = fixture({ amendChat: true });
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'done', job.error);
    assert.ok(f.reviews[0].changes.some(change => change.warning));
    assert.ok(Object.values(f.books.Story.entries).some(e => M.record(e)?.type === 'unit'));
    assert.equal(f.metadata.ranges, undefined);
});

test('a legacy stale list accepts new memories while a locked list stays pending', async () => {
    const entry = { uid: 0, content: '## ► Memories — Zelga\n\n- Zelga met Mira.' };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'memory', storyId: 'story' }, { subject: 'Zelga', status: 'stale' });
    const upgraded = fixture({ existing: { Memories: { entries: { 0: entry } } } });
    const job = await upgraded.w.startFlow('memories');
    assert.equal(job.status, 'done', job.error);
    assert.match(upgraded.books.Memories.entries[0].content, /brass key/);
    entry.sceneArchivist.protection.locked = true;
    const locked = fixture({ existing: { Memories: { entries: { 0: entry } } } });
    const second = await locked.w.startFlow('memories');
    assert.equal(second.status, 'done', second.error);
    assert.equal(locked.books.Memories.entries[0].content, entry.content);
    assert.equal(locked.metadata.workbench.chatMemoryReceipts.length, 0);
});

test('configured capacity is checked before any model request', async () => {
    const f = fixture({ limits: { summary: 2000 } });
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'failed');
    assert.equal(job.steps[0].oversized, true);
    assert.equal(f.calls.length, 0);
});

test('shared continuation preserves the date and verified branches exclude later records', () => {
    const e = { uid: 0, content: '## ► Day 2 — February 14, 2027\n\n- A private reveal.' };
    const chat = [{ name: 'A', mes: 'Earlier' }, { name: 'B', mes: 'Reveal' }];
    e.sceneArchivist = M.makeRecord(e, { type: 'unit', source: M.sourceSnapshot('parent', chat, [{ from: 1, to: 1 }]) });
    const data = { entries: { 0: e }, sceneArchivistStory: { shared: true } };
    const entries = Core.parseArchivistOutput('### ▸ Day 8 — February 14, 2027\n\n- A continuation.').entries;
    placeSharedUnits(data, entries, { mode: 'continue', number: 2 });
    assert.equal(entries[0].heading, '## ► Day 2 — February 14, 2027');
    const branch = projectBranch({ Story: data }, { mode: 'prune', oldSource: 'parent', sourceId: 'child', storyId: 'child', chat: chat.slice(0, 1), archive: 'Story', mapping: { Story: 'Story · Branch #1' } });
    assert.deepEqual(branch.books.Story.entries, {});
});

test('condensation preserves a dated quote and can keep the same number of memories', () => {
    const e = { content: '## ► Memories — Zelga\n\n[Date: February 14, 2027]\n- In great detail Zelga told Mira “Keep the brass key.”\n- She explained that the gate closes at 5 PM.' };
    e.sceneArchivist = M.makeRecord(e, { type: 'memory' });
    const shorter = '## ► Memories — Zelga\n\n[Date: February 14, 2027]\n- Zelga told Mira “Keep the brass key.”\n- The gate closes at 5 PM.';
    const result = M.condensationResult({ entries: [{ id: M.record(e).id, content: shorter }] }, [e], 'shorten');
    assert.equal(Core.parseMemoryDoc(result[0].content).length, 2);
    assert.ok(M.tokens(result[0].content) < M.tokens(e.content));
    assert.throws(() => M.condensationResult({ entries: [{ id: M.record(e).id, content: shorter.replace('5 PM', 'dusk') }] }, [e], 'shorten'), /omitted/);
});

test('one-request mode reuses one response for all three stages', async () => {
    const f = fixture({ prefs: { singleRequest: true } });
    f.config.archiveProfile = f.config.sideProfile;
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'done', job.error);
    assert.equal(f.calls.length, 1);
    assert.equal(f.reviews.length, 1);
    assert.equal(Object.values(f.books.Story.entries).filter(e => M.record(e)?.type === 'tracker').length, 2);
});

test('diary uses raw chat and attached lore, appending only new messages to the saved diary', async () => {
    const f = fixture();
    f.w.value = key => key === 'diaryName' ? 'Zelga' : '';
    const first = await f.w.startDiary();
    assert.equal(first.status, 'done', first.error);
    assert.match(f.calls[0].req.prompt, /Attached lore: Zelga is a locksmith/);
    assert.match(f.calls[0].req.prompt, /I give Zelga the brass key/);
    f.chat.push({ name: 'Zelga', mes: 'Zelga opened the gate.' });
    const second = await f.w.startDiary(true);
    assert.equal(second.status, 'done', second.error);
    const evidence = f.calls[1].req.prompt.split('ORIGINAL CHAT MESSAGES')[1];
    assert.match(evidence, /Zelga opened the gate/);
    assert.doesNotMatch(evidence, /I give Zelga/);
    const entries = Object.values(f.books.Story.entries);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].disable, true);
    assert.match(entries[0].content, /Mira gave me the brass key/);
    assert.match(entries[0].content, /I opened the gate/);
    assert.ok(M.eligible(entries[0]));
    assert.equal(M.record(entries[0]).supplementalSources.length, 1);
});

test('explicit chat scopes and an archive-only full run use the selected evidence', async () => {
    const f = fixture({ prefs: { memorySource: 'archive' } });
    const run = await f.w.startFlow('catch-up');
    assert.equal(run.status, 'done', run.error);
    assert.match(f.calls[1].req.prompt, /Archive entries are the target evidence/);
    assert.match(f.calls[1].req.prompt, /Mira gave Zelga the brass key/);
    const g = fixture();
    const exact = await g.w.startFlow('memories', { from: 1, to: 1 });
    assert.equal(exact.status, 'done', exact.error);
    assert.doesNotMatch(g.calls[0].req.prompt, /I give Zelga/);
    assert.match(g.calls[0].req.prompt, /Zelga thanks Mira/);
});

test('rolling memories leave the newest messages out and prepare one review', async () => {
    const f = fixture({ prefs: { rolling: true, rollingEvery: 1, rollingBuffer: 1 } });
    await f.w.afterReply();
    assert.equal(f.calls.length, 1);
    assert.doesNotMatch(f.calls[0].req.prompt, /Zelga thanks Mira/);
    assert.equal(f.reviews.length, 1);
});

test('an upgrade keeps a paused job and its draft round-trippable', async () => {
    const f = fixture({ failTracker: true });
    const job = await f.w.startFlow('catch-up');
    const backup = M.makeBundle(f.books, f.metadata, f.config);
    const restored = M.parseBundle(JSON.stringify(backup));
    assert.equal(restored.metadata.workbench.job.id, job.id);
    assert.equal(restored.metadata.workbench.job.cursor, 2);
    assert.ok(Object.values(restored.metadata.workbench.job.draft.books.Story.entries).some(e => M.record(e)?.type === 'unit'));
});

test('a copied chat with matching integrity gets separate lorebooks', async () => {
    const f = fixture();
    f.metadata.workbench.chatIntegrity = 'saved-chat';
    f.identity.chatMetadata.integrity = 'saved-chat';
    f.identity.chatId = 'Copied';
    f.w.h.listChatFiles = async () => ['Main', 'Copied'];
    await f.w.ensureBranch();
    assert.equal(f.config.lorebook, 'Story · Copied');
    assert.equal(f.metadata.workbench.branchLineage.parent, 'Main');
    assert.deepEqual(Object.keys(f.books), ['Story', 'Story · Copied']);
});

test('a three-stage estimate sends no request and leaves a prepared draft untouched', async () => {
    const f = fixture();
    f.metadata.workbench.job = { status: 'paused', id: 'existing-draft', steps: [{ output: { saved: true } }] };
    let planned;
    f.w.extras = { estimate: (steps, flow) => { planned = { steps, flow }; } };
    await f.w.startFlow('catch-up', null, null, true);
    assert.deepEqual(planned.steps.map(step => step.kind), ['archive', 'memories', 'tracker-pass']);
    assert.deepEqual(f.calls, []);
    assert.equal(f.metadata.workbench.job.id, 'existing-draft');
    assert.deepEqual(Object.keys(f.books), ['Story']);
});

test('story and selection exports report the manifest version', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
    const entry = { content: 'Some memory' };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'memory' });
    assert.equal(M.makeBundle({}, {}, {}).version, manifest.version);
    assert.equal(selectionExport([entry], [entry.sceneArchivist.id]).version, manifest.version);
});

test('saving group memories writes a native lorebook filter for the assigned card', async () => {
    const f = fixture();
    const group = { speaker: 'zelga.png', members: [{ name: 'Zelga', avatar: 'zelga.png' }, { name: 'Bea', avatar: 'bea.png' }] };
    f.w.h.groupSpeaker = () => group;
    await f.w.startFlow('memories');
    const memory = Object.values(f.books.Memories.entries).find(entry => M.record(entry)?.type === 'memory');
    assert.deepEqual(memory.characterFilter, { names: ['zelga'], tags: [], isExclude: false });
    assert.equal(M.record(memory).subjectAvatar, 'zelga.png');
});

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

test('an unavailable helper profile never borrows current-model capacity', async () => {
    const f = fixture(), lookedUp = [], sent = [];
    f.w.h.flowModelInfo = profile => {
        lookedUp.push(profile);
        if (profile === 'notes') throw new Error('Saved profile unavailable');
        return { name: 'Current', context: 200000, output: 2000 };
    };
    f.w.h.model = async (...args) => { sent.push(args); return 'Done'; };
    await assert.rejects(f.w.call({ system: '', prompt: 'Material', maxTokens: 500 }, 'helper'), /Saved profile unavailable/);
    assert.deepEqual(lookedUp, ['notes']);
    assert.equal(sent.length, 0);
    assert.equal(f.metadata.workbench.telemetry.requests, 0);
});

test('helper preflight and sending retain one profile if settings change during counting', async () => {
    const f = fixture(), sent = [];
    f.w.h.tokenCount = async text => { f.config.sideProfile = 'different'; return M.tokens(text); };
    f.w.h.model = async (request, profile) => { sent.push({ request, profile }); return 'Done'; };
    await f.w.call({ system: '', prompt: 'Material', maxTokens: 500 }, 'helper');
    assert.equal(sent[0].profile, 'notes');
    assert.equal(f.metadata.workbench.telemetry.last.profile, 'notes');
    assert.equal(f.metadata.workbench.telemetry.last.model, 'notes');
});

test('Ask the archive allocates non-empty evidence and answers on the selected helper route', async () => {
    const entry = { uid: 0, content: 'The brass key opened the front gate.', key: ['brass key'] };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'fact', storyId: 'story' }, { id: 'key-evidence' });
    const f = fixture({ existing: { Story: { entries: { 0: entry } } } });
    const result = { innerHTML: '' }, requests = [];
    f.w.root = { querySelector: () => result };
    f.w.showTab = () => {};
    f.w.h.model = async (request, profile) => {
        requests.push({ request, profile });
        return JSON.stringify({ answer: 'The brass key opened the gate [key-evidence].', sources: ['key-evidence'] });
    };
    await f.w.ask('What did the brass key open?');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].profile, 'notes');
    assert.match(requests[0].request.prompt, /SOURCE key-evidence/);
    assert.match(result.innerHTML, /brass key opened the gate/);
    assert.match(result.innerHTML, /key-evidence/);
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

test('reference-heavy context errors name the largest input parts for archive and memories', async () => {
    for (const stage of ['archive', 'memories']) {
        const f = fixture({ limits: { summary: 5000, notes: 5000 },
            prefs: { readReferences: true, references: [{ book: 'World details' }] } });
        f.w.h.readReferences = async () => 'Reference lore about the world. '.repeat(12000);
        const job = await f.w.startFlow(stage);
        assert.equal(job.status, 'failed');
        assert.equal(job.steps[0].oversized, true);
        assert.equal(f.calls.length, 0);
        assert.match(job.error, new RegExp(`${stage} needs about [\\d,]+ input tokens plus 2,000 output tokens \\(model limit 5,000\\)`));
        assert.match(job.error, /Largest parts: reference lorebooks [\d,]+, system instructions [\d,]+, messages [\d,]+\./);
        assert.match(job.error, /Reference lorebooks are the largest part\. Turn off or trim reference lorebooks in Settings/);
        assert.match(job.error, /Choose Split this stage/);
        assert.doesNotMatch(job.error, /scene log 0|SillyTavern chat context/);
    }
});

test('context diagnostics account for chat context and fall back when a part cannot be tokenized', async () => {
    const f = fixture({ limits: { summary: 5000 } });
    f.w.h.buildFlowContext = async () => [{ role: 'system', content: 'A large chat context.' }];
    f.w.h.tokenCount = async text => {
        if (text === 'Reference lore.') throw new Error('Tokenizer unavailable for this part.');
        if (text === 'Instructions.') return 10;
        if (text === 'Selected messages.') return 20;
        return 6000;
    };
    const step = {};
    const job = { options: { flow: { profiles: { archive: 'summary' }, includeChatContext: true } } };
    const req = { system: 'Instructions.', prompt: 'Selected messages.', parts: {
        references: 'Reference lore.', log: '', transcript: 'Selected messages.', system: 'Instructions.',
    } };
    await assert.rejects(f.w.requestFlow(job, step, req, 'archive'), error => {
        const remainder = (6000 - 30 - M.tokens('Reference lore.')).toLocaleString('en-US');
        assert.ok(error.message.includes(`Largest parts: SillyTavern chat context ${remainder}`));
        assert.match(error.message, /SillyTavern chat context is the largest part/);
        assert.match(error.message, /Turn off Include SillyTavern chat context in Settings/);
        assert.doesNotMatch(error.message, /scene log/);
        return true;
    });
    assert.equal(step.oversized, true);
    assert.equal(f.calls.length, 0);
});

test('requests that fit tokenize only the complete input', async () => {
    const f = fixture({ prefs: { readReferences: true, references: [{ book: 'Lore' }] } });
    const counted = [];
    f.w.h.tokenCount = async text => { counted.push(text); return M.tokens(text); };
    const job = await f.w.startFlow('catch-up');
    assert.equal(job.status, 'done', job.error);
    assert.equal(counted.length, f.calls.length);
    assert.equal(f.calls[0].req.parts.references, 'Zelga is a locksmith.');
    assert.equal(f.calls[1].req.parts.references, 'Zelga is a locksmith.');
    assert.ok(f.calls[0].req.prompt.includes(f.calls[0].req.parts.transcript));
    assert.ok(f.calls[1].req.prompt.includes(f.calls[1].req.parts.transcript));
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

test('Ask retrieves a deep complete memory excerpt and its citation opens the stored parent', async () => {
    const content = '## ► Memories ' + String.fromCharCode(0x2014) + ' Zelga\n\n[February 14, 2027 - Day 1]\n'
        + '- Zelga counted a routine crate.\n'.repeat(1500) + '- Zelga hid the brass key in the blue teapot.\n  This is a suspicion, not a confirmed location.';
    const entry = { uid: 0, content };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'memory', storyId: 'story' }, { id: 'zelga-list', subject: 'Zelga' });
    const f = fixture({ existing: { Memories: { entries: { 0: entry } } }, limits: { notes: 4000 } });
    const before = structuredClone(f.books), result = { innerHTML: '' }, requests = [];
    f.w.root = { querySelector: () => result }; f.w.showTab = () => {};
    f.w.h.model = async (request, profile) => {
        requests.push({ request, profile });
        const id = request.prompt.match(/^SOURCE (.+)$/m)[1];
        assert.notEqual(id, 'zelga-list');
        return JSON.stringify({ answer: `The suspected location is the blue teapot [${id}].`, sources: [id] });
    };
    await f.w.ask('Where is the brass key?');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].profile, 'notes');
    assert.match(requests[0].request.prompt, /February 14, 2027/);
    assert.match(requests[0].request.prompt, /This is a suspicion, not a confirmed location/);
    assert.doesNotMatch(requests[0].request.prompt, /routine crate/);
    assert.match(result.innerHTML, /Evidence used/);
    assert.match(result.innerHTML, /data-id="zelga-list"/);
    assert.doesNotMatch(result.innerHTML, /data-id="zelga-list~/);
    assert.match(result.innerHTML, /Original message links belong to the whole saved record/);
    assert.deepEqual(f.books, before);
});

test('Ask refuses a matching bullet that exceeds the helper allowance without making a request', async () => {
    const entry = { uid: 0, content: '## ► Memories ' + String.fromCharCode(0x2014) + ' Zelga\n- Zelga counted linen.\n- A brass key. ' + 'Necessary qualifier. '.repeat(2000) };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'memory', storyId: 'story' }, { id: 'oversized' });
    const f = fixture({ existing: { Memories: { entries: { 0: entry } } }, limits: { notes: 4000 } });
    let calls = 0;
    f.w.h.model = async () => { calls++; return ''; };
    await assert.rejects(f.w.ask('brass key'), /No matching current evidence fits/);
    assert.equal(calls, 0);
});

test('Ask rejects citations to an unselected whole list when only an excerpt was supplied', async () => {
    const entry = { uid: 0, content: '## ► Memories ' + String.fromCharCode(0x2014) + ' Zelga\n- Zelga counted linen.\n- Zelga hid the brass key.' };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'memory', storyId: 'story' }, { id: 'zelga-list' });
    const f = fixture({ existing: { Memories: { entries: { 0: entry } } } });
    let calls = 0;
    f.w.h.model = async () => { calls++; return JSON.stringify({ answer: 'Hidden [zelga-list].', sources: ['zelga-list'] }); };
    await assert.rejects(f.w.ask('brass key'), /did not cite valid evidence/);
    assert.equal(calls, 2);
});

function sourceQuestion() {
    const f = fixture(), entry = { uid: 0, content: 'Zelga and Mira discussed the brass key.' };
    f.chat[0].mes = 'February 14, 2027. Where did you leave the brass key?';
    f.chat[1].mes = 'It might be inside the blue teapot. I have not checked, so the location is unconfirmed.';
    entry.sceneArchivist = M.makeRecord(entry, { type: 'unit', storyId: 'story', source: f.w.source([{ from: 0, to: 1 }]) }, { id: 'key-scene' });
    f.books.Story.entries[0] = entry;
    const result = { innerHTML: '' };
    f.w.root = { querySelector: () => result }; f.w.showTab = () => {};
    return { ...f, result };
}

test('Ask follows insufficient saved evidence with verified original messages once on the helper route', async () => {
    const f = sourceQuestion(), sent = [], before = structuredClone(f.books), jumped = [];
    f.w.h.jumpToMessage = async (index, root) => { assert.equal(root, f.w.root); jumped.push(index); };
    f.w.h.model = async (request, profile) => {
        sent.push({ request, profile });
        if (sent.length === 1) return JSON.stringify({ answer: 'The saved note does not establish the location.', sources: [], needsMore: true, queries: ['brass key location'] });
        const original = request.prompt.match(/^SOURCE (original-.+)$/m)[1];
        assert.match(request.prompt, /blue teapot[\s\S]*unconfirmed/);
        assert.match(request.system, /final retrieval pass/);
        return JSON.stringify({ answer: `Possibly the blue teapot, unconfirmed [${original}].`, sources: [original], needsMore: false, queries: [] });
    };
    await f.w.ask('Where is the brass key?');
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(call => call.profile), ['notes', 'notes']);
    assert.match(f.result.innerHTML, /Hash-verified original messages #0-#1/);
    assert.match(f.result.innerHTML, /One retrieval follow-up was used/);
    assert.match(f.result.innerHTML, /data-sa-action="askSource"/);
    const id = [...f.w.questions.evidence.keys()].find(value => value.startsWith('original-'));
    await f.w.questions.open(id);
    assert.deepEqual(jumped, [0]);
    f.chat[1].mes = 'This is now a different swipe.';
    await assert.rejects(f.w.questions.open(id), /evidence changed/);
    assert.deepEqual(jumped, [0]);
    assert.deepEqual(f.books, before);
});

test('Ask finds omitted source detail without a saved-text match and escapes original message HTML', async () => {
    const f = sourceQuestion();
    f.chat[1].mes += ' <script>alert("story text")</script>';
    M.record(f.books.Story.entries[0]).source = f.w.source([{ from: 0, to: 1 }]);
    let calls = 0;
    f.w.h.model = async request => {
        calls++;
        const id = request.prompt.match(/^SOURCE (original-.+)$/m)[1];
        return JSON.stringify({ answer: `Unconfirmed [${id}].`, sources: [id], needsMore: false });
    };
    await f.w.ask('teapot');
    assert.equal(calls, 1);
    assert.match(f.result.innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(f.result.innerHTML, /<script>/);
});

test('an indirect question can add a related-wording candidate that shared no literal query terms', async () => {
    const f = fixture(), entry = { uid: 0, content: 'Mara takes coffee black, without sugar.' };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'fact', storyId: 'story' }, { id: 'coffee' });
    f.books.Story.entries[0] = entry;
    const result = { innerHTML: '' }, requests = [];
    f.w.root = { querySelector: () => result }; f.w.showTab = () => {};
    f.w.h.model = async request => {
        requests.push(request);
        if (requests.length === 1) {
            assert.match(request.prompt, /No matching saved evidence/);
            return JSON.stringify({ answer: 'The supplied evidence does not establish her preference.', sources: [], needsMore: true, queries: ['usual drink coffee tea preference'] });
        }
        assert.match(request.prompt, /SOURCE coffee[\s\S]*coffee black, without sugar/);
        return JSON.stringify({ answer: 'Black coffee without sugar [coffee].', sources: ['coffee'], needsMore: true, queries: ['more'] });
    };
    await f.w.ask('How should I prepare her usual drink?');
    assert.equal(requests.length, 2, 'even a second needsMore cannot start a retrieval loop');
    assert.match(result.innerHTML, /Black coffee without sugar/);
    assert.equal(f.metadata.workbench.telemetry.requests, 2);
});

test('unknown questions stop after one answer when the follow-up finds no additional evidence', async () => {
    const f = fixture(), result = { innerHTML: '' };
    f.w.root = { querySelector: () => result }; f.w.showTab = () => {};
    let calls = 0;
    f.w.h.model = async () => {
        calls++;
        return JSON.stringify({ answer: 'The available evidence does not establish who stole the crown.', sources: [], needsMore: true, queries: ['emerald crown thief'] });
    };
    await f.w.ask('Who stole the emerald crown?');
    assert.equal(calls, 1);
    assert.match(result.innerHTML, /does not establish/);
    assert.match(result.innerHTML, /No retrieval follow-up was needed/);
});

test('original messages are reverified after token counting and a changed passage reaches no model', async () => {
    const f = sourceQuestion();
    let calls = 0;
    f.w.h.tokenCount = async text => {
        if (text.includes('SOURCE original-')) f.chat[1].mes = 'Edited while counting.';
        return M.tokens(text);
    };
    f.w.h.model = async () => { calls++; return ''; };
    await assert.rejects(f.w.ask('teapot'), /evidence changed/);
    assert.equal(calls, 0);
});

test('a chat change or changed original message during the answer prevents rendering the result', async () => {
    for (const change of [f => { f.identity.chatId = 'Other chat'; }, f => { f.chat[1].mes = 'Different answer.'; }]) {
        const f = sourceQuestion();
        f.w.h.model = async request => {
            const id = request.prompt.match(/^SOURCE (original-.+)$/m)[1];
            change(f);
            return JSON.stringify({ answer: `Old detail [${id}].`, sources: [id] });
        };
        await assert.rejects(f.w.ask('teapot'), /changed/);
        assert.equal(f.result.innerHTML, '');
    }
});

test('foreign and corrected original scenes stay out of a follow-up, even when its query asks for them', async () => {
    for (const amend of [r => { r.source.chatId = 'Foreign'; }, r => { r.authorCorrections = [{ text: 'The key was destroyed.' }]; }]) {
        const f = sourceQuestion(), requests = [];
        amend(M.record(f.books.Story.entries[0]));
        f.w.h.model = async request => {
            requests.push(request);
            assert.doesNotMatch(request.prompt, /blue teapot|SOURCE original-/);
            return JSON.stringify({ answer: 'The supplied note does not establish the location.', sources: [], needsMore: true, queries: ['teapot'] });
        };
        await f.w.ask('brass key');
        assert.equal(requests.length, 1);
        assert.match(f.result.innerHTML, /skipped/);
    }
});

test('a failed question request propagates without starting an alternate search or model route', async () => {
    const f = sourceQuestion(), before = structuredClone(f.books);
    let calls = 0;
    f.w.h.model = async () => { calls++; throw new Error('Selected helper is unavailable'); };
    await assert.rejects(f.w.ask('brass key'), /Selected helper is unavailable/);
    assert.equal(calls, 1);
    assert.equal(f.result.innerHTML, '');
    assert.equal(f.w.questions.completed, null);
    assert.deepEqual(f.books, before);
});

test('native scan excerpt delivery keeps activation rules, a shared cap and unrelated injectors intact', async () => {
    const f = fixture(), content = '## ► Memories ' + String.fromCharCode(0x2014) + ' Zelga\n[February 14, 2027 - Day 1]\n'
        + '- Routine linen count.\n'.repeat(800) + '- The brass key is in a teapot.\n  This is still unconfirmed.';
    const parent = { uid: 1, world: 'Story', sceneArchivistArchive: 'Story', content };
    parent.sceneArchivist = M.makeRecord(parent, { type: 'memory', storyId: 'story' }, { id: 'long-list', subject: 'Zelga' });
    const notActivated = { ...parent, uid: 2, sceneArchivist: { ...M.record(parent), id: 'not-activated' } };
    const external = { uid: 3, world: 'External', content: 'External injector text' };
    const scan = { sortedEntries: [parent, notActivated], activated: { entries: new Map([[1, parent], [3, external]]), text: '' },
        new: { all: [parent, external], successful: [parent, external] }, state: { next: 0, loopCount: 1 } };
    f.w.h.isActive = () => true; f.w.h.scanSupported = true;
    f.w.options().preciseDelivery = true; f.w.options().budget = 400;
    f.w.scanSuppressed = false;
    const before = structuredClone(parent);
    await f.w.onWorldInfoScan(scan);
    assert.equal(scan.activated.entries.size, 2);
    assert.match(scan.activated.entries.get(1).content, /brass key[\s\S]*unconfirmed/);
    assert.doesNotMatch(scan.activated.entries.get(1).content, /Routine linen/);
    assert.equal(scan.activated.entries.get(3), external);
    assert.ok(f.w.lastBudget.used <= 400);
    assert.ok(f.w.lastBudget.omitted.some(item => item.id === 'not-activated' && item.reason === 'not activated by SillyTavern'));
    assert.deepEqual(parent, before);
    assert.equal(scan.new.successful[0], scan.activated.entries.get(1));
});

test('reply recall chooses excerpt ids and related wording while nested quiet events keep the main run', async () => {
    const entry = { uid: 0, content: '## ► Memories ' + String.fromCharCode(0x2014) + ' Zelga\n- Zelga likes coffee black.\n- Zelga counted linen.' };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'memory', storyId: 'story' }, { id: 'zelga-list', subject: 'Zelga' });
    const f = fixture({ existing: { Memories: { entries: { 0: entry } } } });
    f.config.recall = true; f.w.h.isActive = () => true;
    f.chat[0].mes = 'How should I prepare her usual drink?'; f.chat[1].mes = 'She waited.';
    let calls = 0;
    f.w.h.model = async (_request, profile) => {
        calls++; assert.equal(profile, 'notes');
        const run = f.w.sceneRecall.run;
        await f.w.beforeGeneration('quiet', {}, false);
        assert.equal(f.w.sceneRecall.run, run);
        return JSON.stringify({ load: [], queries: ['coffee preference'] });
    };
    await f.w.beforeGeneration('normal', {}, false);
    assert.equal(calls, 1); assert.equal(f.w.scanSuppressed, false);
    assert.ok(f.w.held.has('zelga-list'));
    assert.match(f.w.recallDetails.get('zelga-list')[0].entry.content, /likes coffee black/);
    assert.equal(f.w.generationEpoch, 1);
});

test('a failed memory audit retains extraction and retry sends only the audit', async () => {
    const f = fixture({ prefs: { auditMemories: true } }), sent = [];
    let fail = true;
    f.w.h.sendFlowRequest = async (request, profile) => {
        sent.push({ request, profile });
        if (request.system.startsWith('Audit proposed memories')) {
            if (fail) { fail = false; throw Error('Audit connection unavailable'); }
            return JSON.stringify({ issues: [{ kind: 'knowledge', explanation: 'Review who heard the location.' }] });
        }
        return JSON.stringify({ characters: [{ name: 'Zelga', memories: [{ text: '[Date: February 14, 2027] Mira gave Zelga a brass key.', messages: [0], sourceIds: [], howLearned: 'witnessed' }] }] });
    };
    await f.w.startFlow('memories');
    assert.equal(f.metadata.workbench.job.status, 'failed');
    assert.ok(f.metadata.workbench.job.steps[0].memoryRaw);
    assert.equal(sent.length, 2);
    const fresh = f.create();
    await fresh.queue.resume();
    assert.equal(f.metadata.workbench.job.status, 'done');
    assert.equal(sent.length, 3);
    assert.ok(sent[2].request.system.startsWith('Audit proposed memories'));
    const record = Object.values(f.books.Memories.entries).map(M.record)[0];
    assert.equal(record.memoryEvidence.length, 1);
    assert.match(f.reviews.at(-1).note, /Evidence audit/);
    assert.equal(f.metadata.workbench.job.steps[0].memoryRaw, undefined);
});

test('reference overflow is diagnosed before generation and an explicit fit omits whole entries only', async () => {
    const f = fixture({ prefs: { readReferences: true, references: [{ book: 'Lore', uid: null }], referenceBudget: 100 } });
    f.w.h.readReferenceEntries = async () => [{ book: 'Lore', uid: 1, title: 'Routine', text: 'Linen '.repeat(1000) }, { book: 'Lore', uid: 2, title: 'Key', text: 'Zelga knows locks and brass keys.' }];
    await assert.rejects(f.w.startFlow('archive'), /separate allowance/);
    assert.equal(f.calls.length, 0);
    f.metadata.workbench.flowSettings.referenceFit = 'relevant';
    await f.w.startFlow('archive');
    assert.equal(f.metadata.workbench.job.status, 'done');
    assert.doesNotMatch(f.calls[0].req.prompt, /Linen/);
    assert.match(f.calls[0].req.prompt, /Zelga knows locks/);
    assert.ok(f.alerts.some(text => text.includes('omitted')));
});

test('a paused extraction starts no audit until resume and preserves the received memories', async () => {
    const f = fixture({ prefs: { auditMemories: true } }); let calls = 0;
    f.w.h.sendFlowRequest = async request => {
        calls++;
        if (request.system.startsWith('Audit proposed memories')) return JSON.stringify({ issues: [] });
        await f.w.queue.pause();
        return JSON.stringify({ characters: [{ name: 'Zelga', memories: ['[Date: February 14, 2027] Mira gave Zelga a brass key.'] }] });
    };
    await f.w.startFlow('memories');
    assert.equal(calls, 1); assert.equal(f.metadata.workbench.job.status, 'paused');
    assert.ok(f.metadata.workbench.job.steps[0].memoryRaw);
    await f.w.queue.resume();
    assert.equal(calls, 2); assert.equal(f.metadata.workbench.job.status, 'done');
});

test('a failed optional audit can be skipped without regenerating or discarding extracted memories', async () => {
    const f = fixture({ prefs: { auditMemories: true } }); let calls = 0;
    f.w.h.sendFlowRequest = async request => {
        calls++;
        if (request.system.startsWith('Audit proposed memories')) throw Error('Provider unavailable');
        return JSON.stringify({ characters: [{ name: 'Zelga', memories: ['[Date: February 14, 2027] Mira gave Zelga a brass key.'] }] });
    };
    await f.w.startFlow('memories');
    assert.equal(f.metadata.workbench.job.status, 'failed');
    await f.w.dispatch('skipMemoryAudit', { dataset: {} });
    assert.equal(f.metadata.workbench.job.status, 'done'); assert.equal(calls, 2);
    assert.match(Object.values(f.books.Memories.entries)[0].content, /brass key/);
});

test('a failed condensation audit keeps its shorter proposal and skip returns to review without another request', async () => {
    const entry = { uid: 0, content: '## ► Day 1 - February 14, 2027\nThe brass key opens the gate. ' + 'Routine detail. '.repeat(100) };
    entry.sceneArchivist = M.makeRecord(entry, { type: 'unit', storyId: 'story' }, { id: 'scene' });
    const f = fixture({ existing: { Story: { entries: { 0: entry } } } });
    f.w.options().auditCondense = true;
    let calls = 0;
    f.w.h.sendFlowRequest = async request => {
        calls++;
        if (request.system.startsWith('Compare the shorter proposal')) throw Error('Audit unavailable');
        return JSON.stringify({ entries: [{ id: 'scene', content: '## ► Day 1 - February 14, 2027\nThe brass key opens the gate.' }] });
    };
    await f.w.loadBooks();
    await f.w.startCondense(f.w.entries, false, true);
    assert.equal(f.metadata.workbench.job.status, 'failed');
    assert.ok(f.metadata.workbench.job.steps[0].condenseDraft);
    assert.match(f.books.Story.entries[0].content, /Routine detail/);
    await f.w.dispatch('skipCondenseAudit', { dataset: {} });
    assert.equal(calls, 2); assert.equal(f.metadata.workbench.job.status, 'done');
    assert.doesNotMatch(f.books.Story.entries[0].content, /Routine detail/);
    assert.ok(M.record(f.books.Story.entries[0]).revisions.length);
    assert.equal(f.metadata.workbench.job.steps[0].condenseDraft, undefined);
});

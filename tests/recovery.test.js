import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldInfoIO } from '../world-info-io.js';
import { JobQueue, copy, makeRecord } from '../memory-engine.js';
import * as Journal from '../entry-journal.js';

function storage(options = {}) {
    const server = { book: { entries: { 0: { uid: 0, content: 'Original memory' } } } };
    const calls = [], confirmed = [], cache = new Map();
    const io = createWorldInfoIO({ cache, onSaved: async (...args) => confirmed.push(args), ...options,
        fetch: options.fetch || (async (path, init) => {
            calls.push(path);
            const body = JSON.parse(init.body);
            if (path.endsWith('/edit')) server.book = copy(body.data);
            return { ok: true, json: async () => copy(server.book) };
        }),
    });
    return { io, server, calls, confirmed, cache };
}

test('a save is confirmed by a fresh read before observers receive it', async () => {
    const f = storage(), desired = { entries: { 0: { uid: 0, content: 'Approved replacement', probability: 100 } } };
    assert.deepEqual(await f.io.saveConfirmed('Story', desired), desired);
    assert.deepEqual(f.calls, ['/api/worldinfo/edit', '/api/worldinfo/get']);
    assert.equal(f.confirmed.length, 1);
    const loaded = await f.io.readFresh('Story'); loaded.entries[0].content = 'Unsaved editor text';
    assert.equal(f.cache.get('Story').entries[0].content, 'Approved replacement');
    assert.equal(f.server.book.entries[0].content, 'Approved replacement');
});

test('an acknowledged save with different contents is never reported as confirmed', async () => {
    const f = storage({ fetch: async () => ({ ok: true, json: async () => ({ entries: { 0: { uid: 0, content: 'Concurrent edit' } } }) }) });
    await assert.rejects(f.io.saveConfirmed('Story', { entries: { 0: { uid: 0, content: 'Approved replacement' } } }), /could not be verified/);
    assert.equal(f.confirmed.length, 0);
});

test('a lost write acknowledgement stays unconfirmed even when the server saved it', async () => {
    let server = { entries: {} };
    const f = storage({ fetch: async (path, init) => {
        if (path.endsWith('/edit')) { server = JSON.parse(init.body).data; throw new Error('Connection closed after save'); }
        return { ok: true, json: async () => copy(server) };
    } });
    const desired = { entries: { 0: { uid: 0, content: 'Saved before disconnect' } } };
    await assert.rejects(f.io.saveConfirmed('Story', desired), /Could not confirm/);
    assert.equal(f.confirmed.length, 0);
    assert.deepEqual(await f.io.readFresh('Story'), desired);
});

test('HTTP failures and malformed reads cannot reach save observers', async () => {
    const failed = storage({ fetch: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(failed.io.saveConfirmed('Story', { entries: {} }), /HTTP 503/);
    const corrupt = storage({ fetch: async () => ({ ok: true, json: async () => ({ entries: [] }) }) });
    await assert.rejects(corrupt.io.saveConfirmed('Story', { entries: {} }), /invalid data/);
    assert.equal(failed.confirmed.length + corrupt.confirmed.length, 0);
});

function boot(disk, handlers = {}) {
    const state = copy(disk.state || {});
    const queue = new JobQueue({ state: () => state, persist: async () => { disk.state = copy(state); },
        perform: async () => 'Prepared result', commit: async () => true, ...handlers });
    return { state, queue };
}

test('pausing during a request retains its reply and reload resumes without another request', async () => {
    const disk = {}, counts = { requests: 0, commits: 0 };
    let started, release;
    const ready = new Promise(resolve => { started = resolve; });
    const response = new Promise(resolve => { release = resolve; });
    const handlers = { perform: async () => { counts.requests++; started(); return response; },
        commit: async (_job, step) => { counts.commits++; assert.equal(step.output, 'Prepared result'); return true; } };
    const f = boot(disk, handlers);
    await f.queue.create('archive', [{ kind: 'archive' }]);
    const run = f.queue.resume(); await ready;
    await f.queue.resume(); // Concurrent Resume must not issue a second request.
    await f.queue.pause(); release('Prepared result'); await run;
    assert.equal(disk.state.job.status, 'paused');
    assert.equal(counts.commits, 0);
    const restored = boot(disk, handlers); await restored.queue.resume();
    assert.deepEqual(counts, { requests: 1, commits: 1 });
    assert.equal(disk.state.job.status, 'done');
});

test('canceling an active request prevents its result from being committed', async () => {
    const disk = {}; let started, release, commits = 0;
    const ready = new Promise(resolve => { started = resolve; });
    const response = new Promise(resolve => { release = resolve; });
    const f = boot(disk, { perform: async () => { started(); return response; }, commit: async () => { commits++; return true; } });
    await f.queue.create('archive', [{}]);
    const run = f.queue.resume(); await ready; await f.queue.cancel(); release('Late result'); await run;
    await f.queue.resume();
    assert.equal(commits, 0);
    assert.equal(disk.state.job.status, 'canceled');
    assert.equal(f.queue.running, false);
});

test('a write receipt survives failure between the book save and queue advancement', async () => {
    const disk = {}, applied = new Set(); let requests = 0, writes = 0, fail = true;
    const handlers = { perform: async () => { requests++; return 'Prepared memory'; }, commit: async (_job, step) => {
        if (applied.has(step.id)) return true;
        writes++; applied.add(step.id);
        if (fail) { fail = false; throw new Error('Disconnected after confirmed book save'); }
        return true;
    } };
    const f = boot(disk, handlers); await f.queue.create('memories', [{}]); await f.queue.resume();
    assert.equal(disk.state.job.status, 'failed');
    assert.equal(disk.state.job.cursor, 0);
    const restored = boot(disk, handlers); await restored.queue.resume();
    assert.equal(disk.state.job.status, 'done');
    assert.equal(requests, 1);
    assert.equal(writes, 1);
});

test('a failed durable-intent save prevents a provider request', async () => {
    const disk = {}; let fail = false, requests = 0;
    const f = boot(disk, { persist: async () => {
        if (fail) { fail = false; throw new Error('Metadata save unavailable'); }
        disk.state = copy(f.state);
    }, perform: async () => { requests++; return 'Result'; } });
    await f.queue.create('archive', [{}]); fail = true; await f.queue.resume();
    assert.equal(requests, 0);
    assert.equal(disk.state.job.status, 'failed');
});

test('journal confirmation detects a mismatch and Undo preserves later user edits', () => {
    const entry = { uid: 0, content: 'The key was brass.' };
    entry.sceneArchivist = makeRecord(entry, { type: 'fact', storyId: 'story' }, { id: 'key' });
    const before = { entries: { 0: entry, 1: { uid: 1, content: 'Unrelated entry' } } };
    const after = copy(before); after.entries[0].content = 'The key was iron.';
    const journal = Journal.makeJournal({ id: 'job', archive: 'Story' });
    Journal.stageWrite(journal, 'Story', before, after);
    assert.throws(() => Journal.confirmWrite(journal, 'Story', before), /could not confirm/);
    Journal.confirmWrite(journal, 'Story', after);
    const newer = copy(after); newer.entries[0].content = 'The author corrected the key again.';
    assert.equal(Journal.planUndo(journal, { Story: newer }).conflicts.length, 1);
    const plan = Journal.planUndo(journal, { Story: after });
    const restored = Journal.applyUndo({ Story: after }, plan);
    assert.equal(restored.Story.entries[0].content, 'The key was brass.');
    assert.deepEqual(restored.Story.entries[1], before.entries[1]);
    assert.equal(after.entries[0].content, 'The key was iron.');
});

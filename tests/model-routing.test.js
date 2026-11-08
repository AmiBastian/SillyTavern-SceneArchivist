import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRouter, profileMessages } from '../model-routing.js';

function fixture(overrides = {}) {
    const calls = [], routes = [];
    const router = createModelRouter({
        describe: profile => ({ name: profile ? 'Archive connection' : 'Chat connection' }),
        current: async req => { calls.push({ current: req }); return 'Current reply'; },
        sendProfile: async (profile, messages, output) => { calls.push({ profile, messages, output }); return { content: 'Profile reply' }; },
        onRoute: route => routes.push(route), ...overrides,
    });
    return { router, calls, routes };
}
const request = { system: 'Summarize only.', prompt: 'The gate opened.', maxTokens: 400 };

test('a selected profile alone receives the request and output allowance', async () => {
    const f = fixture();
    assert.equal(await f.router.request(request, 'archive'), 'Profile reply');
    assert.deepEqual(f.calls, [{ profile: 'archive', messages: [
        { role: 'system', content: request.system }, { role: 'user', content: request.prompt },
    ], output: 400 }]);
    assert.deepEqual(f.routes.map(r => r.state), ['requesting', 'received']);
    assert.equal(f.router.lastRoute().profile, 'archive');
    assert.equal(f.router.lastRoute().name, 'Archive connection');
    assert.equal('prompt' in f.router.lastRoute(), false);
});

test('the current model is used only when explicitly selected', async () => {
    const f = fixture();
    assert.equal(await f.router.request(request, ''), 'Current reply');
    assert.deepEqual(f.calls, [{ current: request }]);
    assert.equal(f.router.lastRoute().name, 'Chat connection');
});

test('a failed profile never calls the current model and can be retried on the same route', async () => {
    let attempts = 0;
    const f = fixture({ sendProfile: async () => { if (++attempts === 1) throw new Error('Provider unavailable'); return 'Recovered'; } });
    await assert.rejects(f.router.request(request, 'archive'), /Archive connection.*Provider unavailable.*explicitly choose/);
    assert.equal(f.router.lastRoute().state, 'failed');
    assert.deepEqual(f.calls, []);
    assert.equal(await f.router.request(request, 'archive'), 'Recovered');
    assert.equal(attempts, 2);
});

test('an unavailable saved profile fails before any generation', async () => {
    const f = fixture({ describe: profile => { assert.equal(profile, 'missing'); throw new Error('Saved profile unavailable'); } });
    await assert.rejects(f.router.request(request, 'missing'), /Saved profile unavailable/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.router.lastRoute().profile, 'missing');
    assert.equal(f.router.lastRoute().state, 'failed');
});

test('empty selected-profile responses fail without switching connections', async () => {
    for (const result of ['', '   ', undefined, { content: '' }]) {
        const f = fixture({ sendProfile: async () => result });
        await assert.rejects(f.router.request(request, 'archive'), /returned no text/);
        assert.deepEqual(f.calls, []);
    }
});

test('assembled context is forwarded without duplicating system instructions', async () => {
    const assembled = [{ role: 'system', content: 'Existing instructions' }, { role: 'user', content: 'Existing chat' }];
    const before = structuredClone(assembled);
    const f = fixture();
    await f.router.request({ ...request, assembled }, 'archive');
    assert.deepEqual(f.calls[0].messages, before);
    assert.deepEqual(assembled, before);
    assert.deepEqual(profileMessages({ ...request, assembled: 'Complete prompt' }), [{ role: 'user', content: 'Complete prompt' }]);
});

test('a chat change while a request is running rejects its result', async () => {
    let changed = false;
    const f = fixture({ assert: () => { if (changed) throw new Error('The chat changed'); },
        sendProfile: async () => { changed = true; return 'Old chat reply'; } });
    await assert.rejects(f.router.request(request, 'archive'), /chat changed/);
    assert.equal(f.router.lastRoute().state, 'failed');
});

test('diagnostic failures cannot discard a received reply or trigger another request', async () => {
    const f = fixture({ onRoute: () => { throw new Error('Diagnostic view closed'); } });
    assert.equal(await f.router.request(request, 'archive'), 'Profile reply');
    assert.equal(f.calls.length, 1);
});

test('an older completion does not replace the latest request route', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture({ sendProfile: async profile => profile === 'old' ? pending : 'New reply' });
    const first = f.router.request(request, 'old');
    await f.router.request(request, 'new');
    release('Old reply');
    await first;
    assert.equal(f.router.lastRoute().profile, 'new');
    assert.equal(f.router.lastRoute().state, 'received');
    const copy = f.router.lastRoute(); copy.state = 'modified';
    assert.equal(f.router.lastRoute().state, 'received');
});

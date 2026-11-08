import test from 'node:test';
import assert from 'node:assert/strict';
import { publishRelease } from '../scripts/publish-release.mjs';

const sha = '1'.repeat(40), notes = '# Scene Archivist 2.1.0\n\nReviewed release notes with validation scope and known limits.';
const config = { repository: 'AmiBastian/SillyTavern-SceneArchivist', ref: 'refs/heads/main', sha, token: 'test-only', version: '2.1.0', notes };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('release publishing refuses private repos, other branches and malformed metadata before any API request', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('Must not call'); };
    for (const change of [{ repository: config.repository + '-Dev' }, { ref: 'refs/heads/develop' }, { sha: 'main' }, { version: '../2.1.0' }, { notes: '' }, { token: '' }]) {
        await assert.rejects(publishRelease({ ...config, ...change, fetchImpl }));
    }
    assert.equal(calls, 0);
});

test('a new release creates only its version tag and reviewed notes at the checked commit', async () => {
    const writes = [];
    const result = await publishRelease({ ...config, fetchImpl: async (url, options) => {
        if (options.method === 'GET') return response({}, 404);
        writes.push({ url, body: JSON.parse(options.body) });
        return response({ html_url: 'https://github.com/AmiBastian/SillyTavern-SceneArchivist/releases/tag/v2.1.0' }, 201);
    } });
    assert.equal(result.created, true);
    assert.deepEqual(writes.map(item => item.body), [{ ref: 'refs/tags/v2.1.0', sha }, { tag_name: 'v2.1.0', target_commitish: sha,
        name: 'Scene Archivist 2.1.0', body: notes, draft: false, prerelease: false, make_latest: 'true' }]);
    assert.ok(writes[0].url.endsWith('/git/refs')); assert.ok(writes[1].url.endsWith('/releases'));
});

test('a matching published release is idempotent and never edited', async () => {
    const calls = [];
    const result = await publishRelease({ ...config, fetchImpl: async (url, options) => {
        calls.push(options.method);
        return response(url.includes('/git/ref/') ? { object: { type: 'commit', sha } }
            : { html_url: 'release-url', body: notes, draft: false, prerelease: false });
    } });
    assert.deepEqual(calls, ['GET', 'GET']); assert.equal(result.created, false);
});

test('existing different tags and releases are preserved without writes', async () => {
    for (const conflict of ['tag', 'notes', 'draft', 'prerelease']) {
        const writes = [];
        await assert.rejects(publishRelease({ ...config, fetchImpl: async (url, options) => {
            if (options.method !== 'GET') writes.push(url);
            return response(url.includes('/git/ref/') ? { object: { type: 'commit', sha: conflict === 'tag' ? '2'.repeat(40) : sha } }
                : { body: conflict === 'notes' ? 'different' : notes, draft: conflict === 'draft', prerelease: conflict === 'prerelease' });
        } }));
        assert.deepEqual(writes, []);
    }
});

test('a failed tag write stops publishing and HTTP errors never include credentials', async () => {
    const writes = [];
    await assert.rejects(publishRelease({ ...config, fetchImpl: async (url, options) => {
        if (options.method === 'GET') return response({}, 404);
        writes.push(url); return response({ message: 'test-only secret should not be logged' }, 403);
    } }), error => error.message === 'GitHub release request failed with HTTP 403.');
    assert.equal(writes.length, 1); assert.ok(writes[0].endsWith('/git/refs'));
});

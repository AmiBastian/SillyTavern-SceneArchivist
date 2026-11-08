import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { VERSION } from '../version.js';

const repositoryName = 'AmiBastian/SillyTavern-SceneArchivist';

/** Publish only the checked public main commit. Never move tags or replace releases. */
export async function publishRelease({ repository, ref, sha, token, version, notes, fetchImpl = fetch }) {
    if (repository !== repositoryName || ref !== 'refs/heads/main') throw new Error('Publishing is restricted to public Scene Archivist main.');
    if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Invalid release commit or version.');
    if (typeof notes !== 'string' || notes.trim().length < 50 || notes.length > 100000) throw new Error('Reviewed release notes are required.');
    if (!token) throw new Error('The workflow release token is unavailable.');
    const tag = `v${version}`, base = `https://api.github.com/repos/${repository}`;
    async function request(path, method = 'GET', body) {
        let response;
        try {
            response = await fetchImpl(base + path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
        } catch { throw new Error('The GitHub release request could not complete.'); }
        if (method === 'GET' && response.status === 404) return null;
        if (!response.ok) throw new Error(`GitHub release request failed with HTTP ${response.status}.`);
        return response.json();
    }
    const currentTag = await request(`/git/ref/tags/${tag}`);
    if (currentTag) {
        let target = currentTag.object;
        for (let depth = 0; target?.type === 'tag' && depth < 4; depth++) target = (await request(`/git/tags/${target.sha}`))?.object;
        if (target?.type !== 'commit' || target.sha !== sha) throw new Error('This version tag already points to a different commit. It will not be moved.');
    }
    const existing = await request(`/releases/tags/${tag}`);
    if (existing) {
        if (!currentTag || existing.draft || existing.prerelease || existing.body?.trim() !== notes.trim()) throw new Error('An existing release differs from the reviewed result. It will not be replaced.');
        return { url: existing.html_url, created: false };
    }
    if (!currentTag) await request('/git/refs', 'POST', { ref: `refs/tags/${tag}`, sha });
    const release = await request('/releases', 'POST', { tag_name: tag, target_commitish: sha, name: `Scene Archivist ${version}`,
        body: notes, draft: false, prerelease: false, make_latest: 'true' });
    return { url: release.html_url, created: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (manifest.version !== VERSION || sha !== process.env.GITHUB_SHA) throw new Error('The checked checkout differs from the intended release.');
    const result = await publishRelease({ repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, sha,
        token: process.env.GH_TOKEN, version: VERSION, notes: await readFile(new URL(`../docs/releases/${VERSION}.md`, import.meta.url), 'utf8') });
    console.log(`${result.created ? 'Published' : 'Verified existing release'}: ${result.url}`);
}

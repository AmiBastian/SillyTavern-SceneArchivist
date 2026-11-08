import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { VERSION } from '../version.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['.git', 'node_modules'].includes(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) result.push(...await files(path));
        else if (/\.m?js$/.test(entry.name)) result.push(path);
    }
    return result.sort();
}
const sources = await files(root);
for (const path of sources) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${path}`);
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(/^import\s[^;\n]*?from\s+['"](\.[^'"]+)['"]/gm)) {
        // ST host imports live outside an installed third-party extension.
        if (match[1].startsWith('../../../')) continue;
        await access(resolve(path, '..', match[1]));
    }
}
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const readme = await readFile(join(root, 'README.md'), 'utf8');
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
if (manifest.version !== VERSION || !readme.startsWith(`# Scene Archivist ${VERSION}\n`) || changelog.match(/^## (\d+\.\d+\.\d+)/m)?.[1] !== VERSION) throw new Error('Manifest, version.js, README and latest released changelog version disagree.');
await access(join(root, manifest.js));
await access(join(root, manifest.css));
console.log(`Syntax and local import paths checked for ${sources.length} JavaScript files; release metadata agrees on ${VERSION}.`);

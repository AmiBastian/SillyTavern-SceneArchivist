// Optional browser integration check against an isolated, disposable ST profile.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as M from '../memory-engine.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import { QUALITY_CASES } from '../quality-check.js';

const dataRoot = process.env.SA_SMOKE_DATA_ROOT;
if (!dataRoot) throw new Error('Set SA_SMOKE_DATA_ROOT to the disposable dataRoot used by the test server.');
const releaseMedia = process.env.SA_RELEASE_MEDIA_DIR;
if (releaseMedia) await mkdir(releaseMedia, { recursive: true });
const base = process.env.SA_TEST_URL || 'http://127.0.0.1:18701/';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('The smoke check uses a local disposable test server.');
const userRoot = join(dataRoot, 'default-user'), book = 'Scene Archivist Source Recall QA', file = 'Source Recall QA';
const messages = [
    { name: 'Seraphina', is_user: false, mes: 'February 14, 2027. The gate stood open.' },
    { name: 'Mira', is_user: true, mes: 'Where did you leave the brass key?' },
    { name: 'Seraphina', is_user: false, mes: 'Possibly inside the blue teapot. I have not checked; its location is unconfirmed.' },
].map(message => ({ ...message, send_date: '2026-11-08T00:00:00.000Z', is_name: true, extra: {} }));
const scene = { uid: 0, content: '## ► Day 1 - February 14, 2027\nSeraphina and Mira discussed the brass key.', comment: 'Source recall scene', key: ['brass key'], keysecondary: [],
    constant: false, disable: false, position: 0, order: 5000, probability: 100, selective: true, excludeRecursion: true, preventRecursion: true, sceneArchivistArchive: book };
scene.sceneArchivist = M.makeRecord(scene, { type: 'unit', storyId: 'recall-qa-story', source: M.sourceSnapshot('recall-qa-source', messages, [{ from: 1, to: 2 }]) }, { id: 'key-scene' });
const coffee = { ...scene, uid: 1, content: 'Mara takes coffee black, without sugar.', comment: 'Coffee preference', key: ['coffee'] };
coffee.sceneArchivist = M.makeRecord(coffee, { type: 'fact', storyId: 'recall-qa-story' }, { id: 'coffee' });
await mkdir(join(userRoot, 'worlds'), { recursive: true });
await mkdir(join(userRoot, 'chats/default_Seraphina'), { recursive: true });
const entries = { 0: scene, 1: coffee };
const coreSmoke = process.env.SA_CORE_SMOKE === '1';
if (coreSmoke) {
    const memory = { ...scene, uid: 2, constant: true, ignoreBudget: true, content: '## ► Memories ' + String.fromCharCode(0x2014) + ' Seraphina\n[February 14, 2027 - Day 1]\n'
        + '- QA filler linen inventory.\n'.repeat(1000) + '- Seraphina recalls the brass key wrapped in blue velvet, unconfirmed.' };
    memory.sceneArchivist = M.makeRecord(memory, { type: 'memory', storyId: 'recall-qa-story' }, { id: 'character-list', subject: 'Seraphina' });
    entries[2] = memory;
    for (let i = 0; i < 300; i++) {
        const entry = { ...scene, uid: i + 3, content: `QA inventory row qaunique${i}.`, key: [`qaunique${i}`] };
        entry.sceneArchivist = M.makeRecord(entry, { type: 'fact', storyId: 'recall-qa-story' }, { id: `qa-${i}` });
        entries[i + 3] = entry;
    }
}
await writeFile(join(userRoot, 'worlds', book + '.json'), JSON.stringify({ entries, sceneArchivistStory: { schema: 1, id: 'recall-qa-story', shared: false, books: { [book]: 'archive' } } }));
const config = { lorebook: book, memoryBook: '', memoryTarget: 'separate', memoryFrom: '', memoryTo: '' };
const metadata = { integrity: 'source-recall-qa', world_info: book, sceneArchivist: { config, workbench: {
    storyId: 'recall-qa-story', sourceId: 'recall-qa-source', chatIntegrity: 'source-recall-qa', originChat: file,
    telemetry: { requests: 0, input: 0, output: 0 },
} } };
await writeFile(join(userRoot, 'chats/default_Seraphina', file + '.jsonl'), [JSON.stringify({ user_name: 'Mira', character_name: 'Seraphina', chat_metadata: metadata }), ...messages.map(message => JSON.stringify(message))].join('\n') + '\n');
const settingsPath = join(userRoot, 'settings.json'), settings = JSON.parse(await readFile(settingsPath, 'utf8'));
settings.main_api = 'openai';
settings.extension_settings ||= {};
settings.extension_settings.sceneArchivist = { ...M.copy(DEFAULT_SETTINGS), ...config, sideProfile: '', archiveProfile: '',
    storyBooks: { [book]: { [book]: 'archive' } } };
settings.oai_settings = { ...settings.oai_settings, stream_openai: false, openai_max_context: 16000, openai_max_tokens: 2500 };
await writeFile(settingsPath, JSON.stringify(settings));

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.SA_CHROMIUM_PATH || undefined, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'] });
const errors = [], requests = [];
let page;
try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/horde/**', route => route.fulfill({ json: [] }));
    await page.route('**/api/backends/chat-completions/generate', async route => {
        const input = route.request().postDataJSON();
        const text = (input.messages || []).map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
        requests.push(text);
        let response;
        const quality = QUALITY_CASES.find(sample => text.includes(`CHECK ${sample.id}\n`));
        if (quality) response = { answer: quality.answer, sources: quality.sources };
        else if (text.includes('How should I prepare her usual drink?')) {
            response = text.includes('SOURCE coffee')
                ? { answer: 'Black coffee without sugar [coffee].', sources: ['coffee'], needsMore: false, queries: [] }
                : { answer: 'The supplied evidence does not establish her usual drink.', sources: [], needsMore: true, queries: ['coffee tea beverage preference sugar'] };
        } else {
            const id = text.match(/^SOURCE (original-.+)$/m)?.[1];
            response = id ? { answer: `Possibly the blue teapot, unconfirmed [${id}].`, sources: [id], needsMore: false, queries: [] }
                : { answer: 'The saved note does not establish the location.', sources: [], needsMore: true, queries: ['brass key location'] };
        }
        await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(response) }, finish_reason: 'stop' }] } });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sa_wand_panel', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => { for (const dialog of document.querySelectorAll('dialog[open]')) dialog.querySelector('.popup-button-ok')?.click(); });
    await page.waitForFunction(() => SillyTavern.getContext().characters?.length > 0, { timeout: 15000 });
    await page.evaluate(async file => {
        const host = await import('/script.js');
        const characters = SillyTavern.getContext().characters;
        const id = characters.findIndex(character => /Seraphina/i.test(character.avatar));
        if (id < 0) throw new Error('The disposable profile needs the default Seraphina character.');
        await host.selectCharacterById(String(id), { switchMenu: false });
        await SillyTavern.getContext().openCharacterChat(file);
        for (const dialog of document.querySelectorAll('dialog[open]')) dialog.querySelector('.popup-button-ok')?.click();
    }, file);
    await page.evaluate(() => document.querySelector('#sa_wand_panel').click());
    await page.locator('#sa-tab-library').click();
    await page.getByRole('button', { name: 'All records' }).click();
    await page.locator('.sa-card').filter({ has: page.locator('#sa-evidence-results') }).evaluate(element => { element.open = true; });
    const question = page.locator('[data-sa-field=question]');
    await question.fill('Where is the brass key?');
    await page.locator('[data-sa-action=ask]').click();
    await page.waitForFunction(() => document.querySelector('#sa-evidence-results')?.textContent.includes('Possibly the blue teapot'), { timeout: 30000 });
    assert.equal(requests.length, 2);
    assert.match(await page.locator('#sa-evidence-results').innerText(), /Original messages #1-#2/);
    await page.locator('#sa-evidence-results > article > details').evaluate(element => { element.open = true; });
    assert.match(await page.locator('#sa-evidence-results').innerText(), /unconfirmed/);
    if (releaseMedia) {
        await page.waitForFunction(() => !document.querySelector('#toast-container .toast'), { timeout: 15000 });
        await page.locator('#sa-evidence-results').screenshot({ path: join(releaseMedia, '49-verified-answer.png') });
    }
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    if (process.env.SA_SMOKE_SCREENSHOT) await page.locator('#sa-evidence-results').screenshot({ path: process.env.SA_SMOKE_SCREENSHOT });
    await page.locator('[data-sa-action=askSource]').first().click();
    await page.waitForSelector('#chat .mes[mesid="1"].sa-chat-jump');
    await page.waitForFunction(() => !document.querySelector('.sa-panel')?.dataset.popped);
    await page.evaluate(() => document.querySelector('#sa_wand_panel').click());
    await question.fill('How should I prepare her usual drink?');
    await page.locator('[data-sa-action=ask]').click();
    await page.waitForFunction(() => document.querySelector('#sa-evidence-results')?.textContent.includes('Black coffee without sugar'), { timeout: 30000 });
    assert.equal(requests.length, 4);
    if (coreSmoke) {
        if (!(await page.locator('#sa-tab-story').isVisible())) await page.evaluate(() => document.querySelector('#sa_wand_panel').click());
        await page.locator('#sa-tab-story').click();
        await page.locator('[data-sa-action=workflowPreset]').click();
        const preset = page.locator('dialog[open]').filter({ has: page.getByRole('heading', { name: 'Choose a workflow', exact: true }) });
        await preset.locator('select').selectOption('simple');
        if (releaseMedia) await preset.screenshot({ path: join(releaseMedia, '47-workflow-presets.png') });
        await preset.locator('.popup-button-ok').click();
        await page.waitForFunction(() => document.querySelector('[data-sa-option=preciseDelivery]')?.checked === true);
        if (releaseMedia) {
            await page.locator('.sa-tools-menu > summary').click();
            await page.locator('#sa-tab-settings').click();
            const references = page.locator('.sa-card').filter({ has: page.locator('[data-sa-flow=referenceFit]') });
            await references.evaluate(element => { element.open = true; element.hidden = false; });
            await references.screenshot({ path: join(releaseMedia, '48-reference-allowance.png') });
        }
        await page.locator('#sa-tab-library').click();
        await page.locator('button[data-sa-library-mode=all]').click();
        assert.equal(await page.locator('#sa-library-results > article').count(), 100);
        for (let i = 0; i < 3; i++) await page.locator('[data-sa-action=libraryNext]').click();
        assert.ok(await page.locator('[data-sa-select="qa-299"]').count());
        assert.equal(await page.locator('[data-sa-action=libraryNext]').isDisabled(), true);
        await page.locator('#sa-library-query').fill('qaunique299');
        await page.waitForFunction(() => document.querySelectorAll('#sa-library-results > article').length === 1);
        await page.locator('#sa-library-query').fill('');
        await page.locator('#sa-tab-story').click();
        await page.locator('[data-sa-action=safeDiagnostics]').click();
        const privacy = page.locator('dialog[open]').filter({ has: page.getByRole('heading', { name: 'Review diagnostics before exporting', exact: true }) });
        const diagnostic = await privacy.locator('[aria-label="Diagnostics privacy preview"]').inputValue();
        assert.doesNotMatch(diagnostic, /Seraphina|Mira|teapot|qaunique|http:/);
        await privacy.locator('.popup-button-cancel').click();
        await page.locator('dialog[open] .popup-button-ok').last().click();
        const native = await page.evaluate(async () => {
            const ctx = SillyTavern.getContext();
            const user = { name: 'Mira', is_user: true, mes: 'What about the brass key and blue velvet?', extra: {}, send_date: Date.now() };
            ctx.chat.push(user); ctx.addOneMessage(user, { scroll: true });
            await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STARTED, 'normal', {}, false);
            const prompt = await ctx.getWorldInfoPrompt([user.mes], 16000, false);
            const reply = { name: 'Seraphina', is_user: false, mes: 'A synthetic reply for the smoke test.', extra: {}, send_date: Date.now() };
            ctx.chat.push(reply); ctx.addOneMessage(reply, { scroll: true });
            await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, ctx.chat.length - 1, 'normal');
            await ctx.eventSource.emit(ctx.eventTypes.GENERATION_ENDED, ctx.chat.length);
            return { content: prompt.worldInfoString, trace: reply.extra.sceneArchivistPrompt };
        });
        assert.match(native.content, /blue velvet/);
        assert.doesNotMatch(native.content, /QA filler linen/);
        assert.ok(native.trace.active.find(item => item.id === 'character-list')?.excerpts?.length);
        await page.evaluate(() => document.querySelector('#sa_wand_panel').click());
        await page.locator('[data-sa-action=forgotten]').click();
        const forgotten = page.locator('dialog[open]').filter({ has: page.getByRole('heading', { name: 'Why was this forgotten?', exact: true }) });
        await forgotten.locator('input').fill('blue velvet');
        await forgotten.locator('.sa-prose').filter({ hasText: 'records delivery' }).waitFor();
        await forgotten.locator('.popup-button-ok').click();
        const hostStyles = await page.evaluate(() => ['sheld', 'chat', 'send_form'].map(id => [id, document.getElementById(id).getAttribute('style')]));
        await page.locator('[data-sa-action=dockPromptTrace]').click();
        await page.locator('.sa-trail-dock').waitFor({ state: 'visible' });
        const themeBefore = await page.evaluate(() => ({ body: document.body.getAttribute('style'), root: document.documentElement.getAttribute('style'), fast: jQuery('#fast_ui_mode').prop('checked') }));
        for (const theme of [
            { color: 'rgb(20, 20, 25)', background: 'rgb(245, 245, 245)', fast: false },
            { color: 'rgb(238, 238, 245)', background: 'rgba(20, 20, 25, 0.35)', fast: false },
            { color: 'rgb(238, 238, 245)', background: 'rgba(20, 20, 25, 0.35)', fast: true },
        ]) {
            const rendered = await page.evaluate(async theme => {
                for (const target of [document.body, document.documentElement]) {
                    target.style.setProperty('--SmartThemeBodyColor', theme.color);
                    target.style.setProperty('--SmartThemeBlurTintColor', theme.background);
                    target.style.setProperty('--SmartThemeBlurStrength', '12px');
                }
                jQuery('#fast_ui_mode').prop('checked', theme.fast).trigger('change');
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const dock = document.querySelector('.sa-trail-dock'), style = getComputedStyle(dock), rect = dock.getBoundingClientRect();
                return { color: style.color, background: style.backgroundColor, blur: style.backdropFilter,
                    inside: rect.x >= -1 && rect.y >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 };
            }, theme);
            assert.equal(rendered.color, theme.color); assert.equal(rendered.background, theme.background); assert.equal(rendered.inside, true);
            if (theme.fast) assert.equal(rendered.blur, 'none');
        }
        await page.locator('.sa-trail-dock .sa-review-handle').focus();
        await page.keyboard.press('ArrowLeft');
        if (await page.locator('.sa-trail-reset').isVisible()) await page.locator('.sa-trail-reset').click();
        if (process.env.SA_SMOKE_SCREENSHOT) await page.locator('.sa-trail-dock').screenshot({ path: process.env.SA_SMOKE_SCREENSHOT + '.trail.png' });
        await page.evaluate(theme => {
            for (const [node, value] of [[document.body, theme.body], [document.documentElement, theme.root]]) {
                if (value == null) node.removeAttribute('style'); else node.setAttribute('style', value);
            }
            jQuery('#fast_ui_mode').prop('checked', theme.fast).trigger('change');
        }, themeBefore);
        if (releaseMedia) await page.locator('.sa-trail-dock').screenshot({ path: join(releaseMedia, '50-trail-lines.png') });
        await page.getByRole('button', { name: 'Close trail', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => ['sheld', 'chat', 'send_form'].map(id => [id, document.getElementById(id).getAttribute('style')])), hostStyles);
        await page.evaluate(() => document.querySelector('#sa_wand_panel').click());
        await page.locator('[data-sa-action=groundingCheck]').click();
        const grounding = page.locator('dialog[open]').filter({ has: page.getByRole('heading', { name: 'Test the helper with invented evidence', exact: true }) });
        await grounding.locator('.popup-button-ok').click();
        const score = page.locator('dialog[open]').filter({ has: page.getByRole('heading', { name: 'Connection grounding checks: 5/5 passed', exact: true }) });
        await score.waitFor();
        await score.locator('.popup-button-ok').click();
        assert.equal(requests.length, 9);
        await page.locator('#sa-tab-library').click();
        await page.locator('button[data-sa-library-mode=all]').click();
        await page.locator('.sa-card').filter({ has: page.locator('#sa-evidence-results') }).evaluate(element => { element.open = true; });
    }
    await page.setViewportSize({ width: 420, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // The host closes open popups when changing layout. Reopen the workspace.
    if (!(await page.locator('#sa-evidence-results').isVisible())) await page.evaluate(() => document.querySelector('#sa_wand_panel').click());
    await page.locator('#sa-evidence-results').waitFor({ state: 'visible' });
    await page.locator('#sa-evidence-results').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#sa-evidence-results').isVisible());
    if (process.env.SA_SMOKE_SCREENSHOT) await page.locator('#sa-evidence-results').screenshot({ path: process.env.SA_SMOKE_SCREENSHOT + '.mobile.png' });
    assert.deepEqual(errors, []);
    console.log(`Live ST smoke passed: archive sources, jump, related wording, mobile and no page errors.${coreSmoke ? ' Also passed presets, 303-record paging, reviewed diagnostics, actual native excerpt delivery, delivery traces, forgotten-detail diagnosis, light/dark/solid/transparent/Fast UI trail themes, movement/reset without host style changes, and the grounding-check UI.' : ''} All ${requests.length} model responses were stubbed; no provider call was made.`);
} catch (error) {
    if (page && process.env.SA_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SA_SMOKE_SCREENSHOT + '.failure.png' });
    throw error;
} finally { await browser.close(); }

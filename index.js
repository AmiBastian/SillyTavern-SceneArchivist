// Scene Archivist: runs your archivist prompt and files the result into a lorebook.
// The log lives in lorebook entries delivered through a World Info outlet ({{outlet::scene_log}} in your preset).

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, generateQuietPrompt, generateRaw, chat_metadata, saveMetadata, main_api, characters, this_chid, eventSource, event_types, getCurrentChatId, getRequestHeaders } from '../../../../script.js';
import { callGenericPopup, Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { getCharaFilename, getStringHash } from '../../../utils.js';
import { hideChatMessageRange } from '../../../chats.js';
import { selected_world_info, METADATA_KEY, createNewWorldInfo, createWorldInfoEntry, loadWorldInfo, saveWorldInfo, updateWorldInfoList, reloadEditor, world_info } from '../../../world-info.js';
import { oai_settings } from '../../../openai.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { power_user } from '../../../power-user.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import * as Core from './core.js';
import * as Memory from './memory-engine.js';
import { Workbench } from './workbench.js';
import { entryReasons } from './vector-diagnostics.js';
import { DEFAULT_SETTINGS, DEFAULT_PROMPT, DEFAULT_PROMPT_KEY_EVENTS, BUILTIN_PROMPTS, LEGACY_MEMORY_PROMPTS, LEGACY_CONDENSE_PROMPTS, TRACKER_TEMPLATES } from './defaults.js';

const KEY = 'sceneArchivist';
const VERSION = '1.0.2';
const LOG = '[Scene Archivist]';
const UNDO_SUFFIX = ' (Archivist undo)';
let busy = false;
let operationChat = null;
let chatRevision = 0;
let operationRevision = 0;
let scopedSettings = null;
let pendingUndo = null;
let workbench = null;
let archiveSource = null;
let archiveStep = '';
let registeredUnitSignature = '';
const clone = value => JSON.parse(JSON.stringify(value));
const CHAT_SETTINGS = new Set(['lorebook', 'memoryBook', 'memoryTarget', 'memoryFrom', 'memoryTo']);

function assertCurrentChat() {
    if (operationChat && (operationChat !== getContext().chat || operationRevision !== chatRevision)) throw new Error('The chat changed. Reopen the original chat and run the operation again.');
}

function chatSettings(global) {
    const m = (chat_metadata[KEY] ??= {});
    if (!m.config) {
        // Never infer story ownership from a progress marker alone.
        const attached = chat_metadata[METADATA_KEY];
        const archive = attached && (attached === global.lorebook || global.storyBooks?.[attached]) ? attached : '';
        const legacy = archive && archive === global.lorebook;
        m.config = { lorebook: archive, memoryBook: legacy ? global.memoryBook : '',
            memoryTarget: legacy ? global.memoryTarget : 'separate', memoryFrom: '', memoryTo: '' };
    }
    return m.config;
}

let recallBusy = false;
const held = new Map(); // uid -> messages left that Recall keeps this entry loaded (keeps the prompt steady between turns)

function settings() {
    // Mutate in place: handlers keep a reference to this object, so it must never be replaced.
    const cur = (extension_settings[KEY] ??= {});
    // Anyone who used an earlier version was delivering through an outlet; keep that for them.
    if (!('delivery' in cur) && ('lorebook' in cur || 'outlet' in cur)) cur.delivery = 'outlet';
    if (!('archiveMode' in cur) && ('lorebook' in cur || 'prompt' in cur)) cur.archiveMode = 'chat'; // earlier versions summarized through the chat itself
    // An existing custom prompt is kept as a library entry so nothing the user wrote is lost.
    if (!('promptId' in cur) && typeof cur.prompt === 'string' && cur.prompt.trim() && cur.prompt !== DEFAULT_PROMPT) {
        cur.promptLibrary = [{ id: 'u-migrated', name: 'My prompt', text: cur.prompt }];
        cur.promptId = 'u-migrated';
    }
    if (LEGACY_MEMORY_PROMPTS.includes(cur.memoryPrompt)) delete cur.memoryPrompt;
    if (LEGACY_CONDENSE_PROMPTS.includes(cur.condensePrompt)) delete cur.condensePrompt;
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (!(k in cur)) cur[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    const units = [cur.unit, ...cur.promptLibrary.map(p => p.unit)].filter(Boolean);
    const unitSignature = JSON.stringify(units);
    if (unitSignature !== registeredUnitSignature) { Core.registerUnits(units); registeredUnitSignature = unitSignature; }
    const oldRule = 'If narrative contradicts established state: **state wins.** Add one conflict bullet. Never silently resolve.';
    const newRule = 'Explicit user corrections and retcons override earlier summaries. Update affected state sections and identify the correction. New events may change an earlier state; record that change. For a genuine unresolved contradiction, preserve both accounts with their sources and add one conflict bullet for review. Never treat an earlier summary as automatically authoritative, and never silently resolve uncertainty.';
    const fixRule = text => typeof text === 'string' ? text.replace(oldRule, newRule).replace('Omit `<OOC>`.', 'Omit out-of-character chatter, but apply explicit user corrections and retcons as canon instructions.') : text;
    cur.prompt = fixRule(cur.prompt);
    for (const prompt of cur.promptLibrary) prompt.text = fixRule(prompt.text);
    if (!scopedSettings) scopedSettings = new Proxy(cur, {
        get(target, key) { return CHAT_SETTINGS.has(key) ? chatSettings(target)[key] : target[key]; },
        set(target, key, value) {
            if (CHAT_SETTINGS.has(key)) {
                chatSettings(target)[key] = value;
                void saveMetadata().catch(e => console.error(LOG, 'Could not save chat settings', e));
            } else target[key] = value;
            return true;
        },
    });
    return scopedSettings;
}

function coreOpts() {
    const s = settings();
    return {
        delivery: s.delivery || 'outlet',
        depth: Number(s.depth ?? 4),
        role: Number(s.role ?? 0),
        outlet: (s.outlet || 'scene_log').trim(),
        keepDays: Number(s.keepDays),
        sticky: 0,
        scanDepth: Number(s.scanDepth),
        legend: Core.unitize(s.legend, s.unit),
        openingText: Core.unitize(s.opening, s.unit),
    };
}

// Names that appear everywhere make useless keywords: the user, the active character(s), plus anything listed in settings.
function autoAvoid() {
    const out = new Set();
    try {
        const ctx = getContext();
        const names = [ctx.name1, ctx.name2, ...(ctx.groupId ? (ctx.groups?.find(g => g.id === ctx.groupId)?.members ?? []).map(m => ctx.characters?.find(c => c.avatar === m)?.name) : [])];
        for (const n of names.filter(Boolean)) { out.add(n); for (const part of String(n).split(/\s+/)) if (part.length >= 3) out.add(part); }
    } catch { /* ignore */ }
    return [...out];
}
const avoidList = () => [...new Set([...settings().avoid.split(',').map(x => x.trim()).filter(Boolean), ...autoAvoid()])];
const esc = (t) => $('<div>').text(String(t ?? '')).html();
const lorebookNames = () => getContext().getWorldInfoNames().filter(n => !n.endsWith(UNDO_SUFFIX));
const hasBackup = (name) => !!name && getContext().getWorldInfoNames().includes(name + UNDO_SUFFIX);

function setStatus(items) {
    const ul = items.map(i => `<li class="sa-${i.level}">${esc(i.text)}</li>`).join('');
    $('#sa_status').html(`<ul>${ul}</ul>`);
}

// ---------------------------------------------------------------- lorebook helpers

async function refreshLorebookList(selectName) {
    const s = settings();
    const names = lorebookNames();
    const sel = $('#sa_lorebook').empty();
    sel.append('<option value="">(none selected)</option>');
    for (const n of names) sel.append($('<option>').val(n).text(n));
    if (selectName) { s.lorebook = selectName; registerStoryBook(selectName, selectName, 'archive'); }
    if (s.lorebook && !names.includes(s.lorebook)) s.lorebook = '';
    sel.val(s.lorebook);
    await updateInfoLine();
}

async function updateInfoLine() {
    const s = settings();
    $('#sa_undo').prop('disabled', !undoBooks().length);
    if (!s.lorebook) { $('#sa_info').text(names0() ? 'Pick a lorebook, or create one below.' : 'No lorebooks exist yet. Create one below.'); return; }
    const data = await loadWorldInfo(s.lorebook);
    if (!data) { $('#sa_info').text('Could not load this lorebook.'); return; }
    $('#sa_undo').prop('disabled', !undoBooks().length);
    const sum = Core.managedSummary(data);
    const memThrough = Number(s.memoryProgress?.[s.lorebook] ?? 0);
    const u = s.unit || 'Day';
    $('#sa_info').text(sum.total ? `${sum.total} log entries: ${sum.constant} always on, ${sum.keyed} keyed. Latest ${u}: ${sum.lastDay || 'none'}. Check Characters for source-by-source memory coverage.` : 'This lorebook has no Scene Log yet. The first run will create it.');
}
const names0 = () => lorebookNames().length > 0;

async function createLorebook() {
    if (busy) return;
    const name = String($('#sa_newname').val() ?? '').trim();
    if (!name) { toastr.warning('Type a name for the new lorebook first.'); return; }
    if (lorebookNames().includes(name)) { toastr.info('That lorebook already exists, so I selected it.'); await refreshLorebookList(name); saveSettingsDebounced(); return; }
    const ok = await createNewWorldInfo(name);
    if (!ok) { toastr.error('Could not create the lorebook.'); return; }
    await updateWorldInfoList();
    await refreshLorebookList(name);
    saveSettingsDebounced();
    toastr.success(`Created "${name}". Run the archivist to fill it.`);
}

// ---------------------------------------------------------------- setup check

function isLorebookActive(name) {
    try {
        if (selected_world_info?.includes(name)) return 'global';
        if (chat_metadata?.[METADATA_KEY] === name) return 'chat';
        const ch = characters?.[this_chid];
        if (ch?.data?.extensions?.world === name) return 'character';
        if (world_info?.charLore?.some(e => e.name === getCharaFilename(this_chid) && e.extraBooks?.includes(name))) return 'character';
        if (power_user?.persona_description_lorebook === name) return 'persona';
    } catch (e) { console.warn(LOG, e); }
    return null;
}

function deliveryLabel(o) {
    return ({
        outlet: `the "${o.outlet}" outlet`,
        before: 'before character definitions',
        after: 'after character definitions',
        depth: `depth ${o.depth} (${['system', 'user', 'assistant'][o.role] ?? 'system'} role)`,
    })[o.delivery] ?? 'the chosen position';
}

function presetUsesOutlet(outlet) {
    try {
        if (main_api !== 'openai') return null;
        const needle = `{{outlet::${outlet}}}`.replace(/\s+/g, '');
        const hits = (oai_settings.prompts ?? []).filter(p => typeof p?.content === 'string' && p.content.replace(/\s+/g, '').includes(needle));
        if (!hits.length) return false;
        // The prompt must also be switched on in the active prompt order (ST uses the order with character_id 100001).
        const order = (oai_settings.prompt_order ?? []).find(o => Number(o?.character_id) === 100001)?.order;
        if (!Array.isArray(order)) return true;
        return hits.some(h => order.some(x => x.identifier === h.identifier && x.enabled)) ? true : 'off';
    } catch { return null; }
}

async function checkSetup() {
    const s = settings();
    const o = coreOpts();
    const out = [];
    if (!s.lorebook) { out.push({ level: 'bad', text: 'No lorebook selected.' }); setStatus(out); return out; }
    const data = await loadWorldInfo(s.lorebook);
    if (!data) { out.push({ level: 'bad', text: `Lorebook "${s.lorebook}" could not be loaded.` }); setStatus(out); return out; }
    const sum = Core.managedSummary(data);
    out.push({ level: 'ok', text: `Lorebook "${s.lorebook}" loaded (${sum.total} log entries).` });
    const act = isLorebookActive(s.lorebook);
    if (act) out.push({ level: 'ok', text: `The lorebook is active for this chat (${act}).` });
    else out.push({ level: 'warn', text: 'The lorebook is not active for this chat, so the model will not see it. Use "Attach to this chat" below, or add it as a global lorebook.' });
    const entries = Object.values(data.entries ?? {}).filter(e => Core.classifyEntry(e));
    const off = entries.filter(e => !Core.matchesDelivery(e, o));
    const where = deliveryLabel(o);
    if (entries.length && off.length) out.push({ level: 'warn', text: `${off.length} log entries are not set to ${where}. Use "Fix delivery settings" below.` });
    else if (entries.length) out.push({ level: 'ok', text: `All log entries are set to ${where}.` });
    if (o.delivery === 'outlet') {
        const pre = presetUsesOutlet(o.outlet);
        if (pre === true) out.push({ level: 'ok', text: `Your preset contains {{outlet::${o.outlet}}}.` });
        else if (pre === 'off') out.push({ level: 'warn', text: `A prompt with {{outlet::${o.outlet}}} exists in your preset but is switched off or missing from the prompt list, so it is not being sent. Enable it in the Prompt Manager.` });
        else if (pre === false) out.push({ level: 'warn', text: `No prompt in your current preset contains {{outlet::${o.outlet}}}. Put it where {{summary}} used to be, or tick "Append the current log to my prompt" below.` });
        else out.push({ level: 'warn', text: 'Could not check the preset (only Chat Completion presets are checked).' });
    } else if (o.delivery === 'before' || o.delivery === 'after') {
        const id = o.delivery === 'before' ? 'worldInfoBefore' : 'worldInfoAfter';
        const order = (oai_settings?.prompt_order ?? []).find(x => Number(x?.character_id) === 100001)?.order;
        const on = Array.isArray(order) ? order.some(x => x.identifier === id && x.enabled) : null;
        if (on === false) out.push({ level: 'warn', text: `Your preset has its "World Info (${o.delivery})" prompt switched off, so these entries are not sent. Enable it in the Prompt Manager.` });
        else out.push({ level: 'ok', text: 'No preset change is needed for this delivery mode.' });
    } else out.push({ level: 'ok', text: 'No preset change is needed for this delivery mode.' });
    const budget = entries.filter(e => e.constant && !e.ignoreBudget).length;
    if (budget) out.push({ level: 'warn', text: `${budget} always-on entries do not ignore the World Info budget, so they could be dropped if the budget runs out.` });
    if (!s.prompt.trim()) out.push({ level: 'bad', text: 'The archivist prompt is empty.' });
    setStatus(out);
    return out;
}

async function fixOutlet() {
    if (busy) return;
    const s = settings(); const o = coreOpts();
    if (!s.lorebook) return;
    const data = await loadWorldInfo(s.lorebook);
    let n = 0;
    for (const e of Object.values(data.entries ?? {})) {
        if (!Core.classifyEntry(e)) continue;
        if (e.constant && !e.ignoreBudget) { e.ignoreBudget = true; n++; }
    }
    n += Core.convertDelivery(data, o);
    await saveWorldInfo(s.lorebook, data, true);
    try { reloadEditor(s.lorebook); } catch { /* editor closed */ }
    toastr.success(n ? `Updated ${n} settings on log entries.` : 'Nothing to fix.');
    await checkSetup();
}

async function attachToChat() {
    if (busy) return;
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick a lorebook first.'); return; }
    chat_metadata[METADATA_KEY] = s.lorebook;
    await saveMetadata();
    $('.chat_lorebook_button').addClass('world_set');
    toastr.success(`"${s.lorebook}" is now this chat's lorebook.`);
    await checkSetup();
}

// ---------------------------------------------------------------- keywords

async function fillKeys(plan, data) {
    const s = settings();
    const avoid = avoidList();
    const items = [...plan.adds.filter(a => a.include).map(a => ({ ref: a, content: a.content })), ...plan.demotions.filter(d => d.needsKeys).map(d => ({ ref: d, content: d.content }))];
    if (!items.length) return;
    const existing = Object.values(data.entries ?? {}).filter(e => Core.classifyEntry(e)).map(e => e.content);
    const corpus = [...existing, ...items.map(i => i.content)];
    const heur = items.map(i => Core.suggestKeys(i.content, corpus.filter(c => c !== i.content), { avoid }));
    let ai = null;
    if (s.keyMode === 'ai') {
        try {
            const kp = Core.buildKeywordPrompt(items, avoid);
            ai = (await sideJson({ prompt: kp.prompt, system: kp.system, maxTokens: 1200 }, t => Core.parseKeywordResponse(t, items.length), 'keywords')).value;
            if (!ai) plan.warnings.push('The keyword request did not return usable JSON, so automatic keywords were used.');
        } catch (e) {
            console.warn(LOG, 'keyword generation failed', e);
            plan.warnings.push('The keyword request failed (' + (e?.message ?? e) + '), so automatic keywords were used.');
        }
    }
    items.forEach((it, i) => {
        let keys = Core.cleanKeys(ai?.[i] ?? [], avoid);
        if (keys.length < 4) keys = Core.withVariants([...keys, ...heur[i]]).slice(0, 12);
        it.ref.keys = keys;
    });
}

// ---------------------------------------------------------------- review popup

async function showReview(plan, parsed, lorebookName) {
    const root = document.createElement('div');
    root.className = 'sa-review';
    const bits = [];
    if (plan.adds.length) bits.push(`${plan.adds.length} new ${plan.adds.length === 1 ? 'entry' : 'entries'}`);
    if (plan.states.length) bits.push(`${plan.states.length} updated ${plan.states.length === 1 ? 'state' : 'states'}`);
    if (plan.demotions.length) bits.push(`${plan.demotions.length} moved out of always-on`);
    root.innerHTML = `<h3>Write to "${esc(lorebookName)}"</h3><div class="sa-note">${esc(bits.join(' · ') || 'Nothing to write.')}${plan.seed ? ' · The lorebook has no Scene Log yet, so the wrapper, epoch and legend will be created.' : ''}</div>`;
    for (const w of plan.warnings) root.insertAdjacentHTML('beforeend', `<div class="sa-warnline">▲ ${esc(w)}</div>`);

    const refs = { adds: [], states: [], demotions: [] };
    const mkDetails = (title, badge, open) => {
        const d = document.createElement('details'); if (open) d.open = true;
        d.innerHTML = `<summary><input type="checkbox" checked><b>${esc(title)}</b><span class="sa-badge">${esc(badge)}</span></summary>`;
        return d;
    };
    for (const a of plan.adds) {
        const d = mkDetails(a.label, a.constant ? 'always on' : 'keyed', false);
        d.insertAdjacentHTML('beforeend', `<div class="sa-note">Keywords, comma separated. The entry loads when one appears in the recent chat.</div><input class="text_pole sa-keys" type="text"><textarea class="text_pole"></textarea>`);
        d.querySelector('.sa-keys').value = a.keys.join(', ');
        d.querySelector('textarea').value = a.content;
        root.append(d);
        refs.adds.push({ a, d });
    }
    for (const st of plan.states) {
        const d = mkDetails(st.name, `${st.oldBullets} to ${st.newBullets} bullets`, !!st.warn);
        if (st.warn) d.insertAdjacentHTML('beforeend', `<div class="sa-warnline">▲ ${esc(st.warn)}</div>`);
        d.insertAdjacentHTML('beforeend', '<textarea class="text_pole"></textarea>');
        d.querySelector('textarea').value = st.content;
        root.append(d);
        refs.states.push({ st, d });
    }
    for (const dm of plan.demotions) {
        const d = mkDetails(dm.label, 'moves to keyed', false);
        d.insertAdjacentHTML('beforeend', `<div class="sa-note">This Day leaves the always-on window and will load only when its keywords appear.${dm.needsKeys ? ' It had no keywords, so these were added.' : ''}</div>${dm.needsKeys ? '<input class="text_pole sa-keys" type="text">' : ''}`);
        if (dm.needsKeys) d.querySelector('.sa-keys').value = dm.keys.join(', ');
        root.append(d);
        refs.demotions.push({ dm, d });
    }
    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: 'Write to lorebook', cancelButton: 'Cancel', wide: true, large: true, allowVerticalScrolling: true });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return false;
    const parseKeys = (v) => Core.withVariants(String(v).split(',').map(x => x.trim()).filter(Boolean));
    for (const { a, d } of refs.adds) { a.include = d.querySelector('input[type=checkbox]').checked; a.keys = parseKeys(d.querySelector('.sa-keys').value); a.content = d.querySelector('textarea').value.trim(); }
    for (const { st, d } of refs.states) { st.include = d.querySelector('input[type=checkbox]').checked; st.content = d.querySelector('textarea').value.trim(); }
    for (const { dm, d } of refs.demotions) { dm.include = d.querySelector('input[type=checkbox]').checked; const k = d.querySelector('.sa-keys'); if (k) dm.keys = parseKeys(k.value); }
    return true;
}

// ---------------------------------------------------------------- main flow

function beginUndoWrite() {
    assertCurrentChat();
    const s = settings();
    const current = chat_metadata[KEY] ?? {};
    // Undo cancels the restored job, so its potentially large private draft is
    // not part of the undo snapshot. The live job keeps it for crash recovery.
    const wb = current.workbench;
    const job = wb?.job?.options?.bulk ? { ...wb.job, draft: undefined, steps: wb.job.steps.map(({ output, ...step }) => step) } : wb?.job;
    const before = clone({ ...current, ...(wb ? { workbench: { ...wb, job } } : {}) });
    delete before.undo;
    const progress = s.memoryProgress?.[s.lorebook];
    pendingUndo = { archive: s.lorebook, before, books: {},
        memoryProgress: progress ?? null,
        visibility: (getContext().chat ?? []).map(m => ({ signature: messageSignature(m), hidden: !!m.is_system })) };
}

function messageSignature(m) {
    // Includes message contents so shifted/deleted/edited messages are never hidden by mistake.
    const text = JSON.stringify([m.name, m.is_user, m.mes]);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return `${text.length}:${h >>> 0}`;
}

async function saveUndoSnapshot(name, data) {
    assertCurrentChat();
    if (!pendingUndo) throw new Error('No restore point was started.');
    if (!(name in pendingUndo.books)) pendingUndo.books[name] = clone(data);
    chat_metadata[KEY].undo = clone(pendingUndo);
    // Save the restore point before changing any lorebook. Failure aborts the write.
    await saveMetadata();
    assertCurrentChat();
    $('#sa_undo').prop('disabled', !undoBooks().length);
}

const undoBooks = () => Object.keys(chat_metadata?.[KEY]?.undo?.books ?? {});

async function undoLast() {
    if (busy) { toastr.info('Wait for the current operation to finish before using Undo.'); return; }
    const undo = chat_metadata?.[KEY]?.undo;
    if (!undo || !Object.keys(undo.books).length) { toastr.info('There is no complete restore point for this chat yet. New writes create one.'); return; }
    const ok = await callGenericPopup('Restore the last write, including its lorebooks, archive ledger, memory progress and message visibility? Later manual edits to these lorebooks will be replaced.', POPUP_TYPE.CONFIRM);
    if (ok !== POPUP_RESULT.AFFIRMATIVE && ok !== true) return;
    busy = true; operationChat = getContext().chat; operationRevision = chatRevision;
    try {
        for (const [book, data] of Object.entries(undo.books)) {
            assertCurrentChat();
            await saveWorldInfo(book, clone(data), true);
            try { reloadEditor(book); } catch { /* editor closed */ }
        }
        assertCurrentChat();
        const chat = getContext().chat ?? [];
        let skipped = 0;
        for (let i = 0; i < undo.visibility.length; i++) {
            const saved = undo.visibility[i];
            if (!chat[i] || messageSignature(chat[i]) !== saved.signature) { skipped++; continue; }
            if (!!chat[i].is_system !== saved.hidden) {
                await hideChatMessageRange(i, i, !saved.hidden);
                assertCurrentChat();
            }
        }
        const s = settings();
        if (undo.memoryProgress == null) delete s.memoryProgress[undo.archive];
        else s.memoryProgress[undo.archive] = undo.memoryProgress;
        chat_metadata[KEY] = clone(undo.before);
        // The snapshot was taken while the undone job was still open. Left alone it would block every later run.
        const wbState = chat_metadata[KEY].workbench;
        if (wbState?.job && !['done', 'canceled'].includes(wbState.job.status)) { wbState.job.status = 'canceled'; wbState.job.error = 'Canceled by Undo.'; }
        pendingUndo = null;
        saveSettingsDebounced();
        await saveMetadata();
        await refreshChatUi();
        toastr.success('Restored the last write, its progress and message visibility.');
        if (skipped) toastr.warning(`${skipped} edited or removed messages were left unchanged.`);
    } catch (e) { console.error(LOG, e); toastr.error('Undo was not completed: ' + (e?.message ?? e)); }
    finally { busy = false; operationChat = null; }
    if (workbench) await workbench.refresh().catch(e => console.warn(LOG, e));
}

async function commit(plan, parsed, name, expectedHash = '') {
    assertCurrentChat();
    if (archiveStep && workbench?.state().job?.status !== 'running') throw new Error('The archive job was paused or canceled before the write. Its output is saved for review.');
    beginUndoWrite();
    const o = coreOpts();
    const data = (await loadWorldInfo(name)) ?? { entries: {} };
    if (expectedHash && Memory.bookHash(data) !== expectedHash) throw new Error('The archive changed while you were reviewing. The response is saved; review it against the new version before writing.');
    const before = clone(data);
    if (archiveSource && !Memory.checkSource(archiveSource, workbench?.state().storyId || archiveSource.chatId, getContext().chat || []).valid) throw new Error('The transcript changed while the output was being reviewed. No archive write was made.');
    await saveUndoSnapshot(name, data);
    const makeEntry = (d) => createWorldInfoEntry(name, d);
    const rep = Core.applyPlan(data, plan, parsed, o, makeEntry);
    const changed = Memory.captureChanges(data, before, Core.classifyEntry, { storyId: workbench?.state().storyId || '', source: archiveSource || undefined, reason: 'Archive write' });
    for (const e of Object.values(data.entries)) if (Memory.record(e)?.storyId === (workbench?.state().storyId || '')) e.sceneArchivistArchive = name;
    Memory.invalidate(Object.values(data.entries), changed.filter(id => Object.values(before.entries || {}).some(e => Memory.record(e)?.id === id)), 'An archive source was updated');
    if (archiveStep) data.sceneArchivistReceipts = Memory.unique([...(data.sceneArchivistReceipts || []), archiveStep]);
    await saveWorldInfo(name, data, true);
    assertCurrentChat();
    try { reloadEditor(name); } catch { /* editor closed */ }
    const sum = Core.managedSummary(data);
    settings().lastWriteBooks = [name]; saveSettingsDebounced();
    chat_metadata[KEY] = { ...(chat_metadata[KEY] ?? {}), lastDay: sum.lastDay, at: Date.now(), messages: getContext().chat?.length ?? 0 };
    await saveMetadata();
    await updateInfoLine();
    const parts = [];
    if (rep.seeded) parts.push('created the Scene Log structure');
    if (rep.added.length) parts.push(`added ${rep.added.length} ${rep.added.length === 1 ? 'entry' : 'entries'}`);
    if (rep.states.length) parts.push(`updated ${rep.states.length} ${rep.states.length === 1 ? 'state' : 'states'}`);
    if (rep.demoted.length) parts.push(`moved ${rep.demoted.length} to keyed`);
    toastr.success(parts.length ? `Archive updated: ${parts.join(', ')}.` : 'Nothing was changed.');
}

async function prepareArchive(text, data) {
    const s = settings();
    const parsed = Core.parseArchivistOutput(text);
    if (!parsed.entries.length && !Object.keys(parsed.states).length) {
        throw new Error(`I could not find any ${s.unit || 'story unit'} entries or states in that output. Nothing was marked complete.`);
    }
    const plan = Core.planChanges(data, parsed, coreOpts());
    const stale = Object.values(data.entries ?? {}).filter(e => Core.classifyEntry(e) && !Core.matchesDelivery(e, coreOpts())).length;
    if (stale) plan.warnings.push(`${stale} existing log entries use a different delivery setting. Writing will move them to ${deliveryLabel(coreOpts())}.`);
    await fillKeys(plan, data);
    return { parsed, plan };
}

async function handleOutput(text) {
    assertCurrentChat();
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick or create a lorebook first.'); return false; }
    const data = (await loadWorldInfo(s.lorebook)) ?? { entries: {} };
    const { parsed, plan } = await prepareArchive(text, data);
    if (s.review) {
        const ok = await showReview(plan, parsed, s.lorebook);
        if (!ok) { toastr.info('Cancelled. Nothing was written.'); return false; }
    }
    assertCurrentChat();
    if (!plan.adds.some(a => a.include && a.content.trim()) && !plan.states.some(a => a.include && a.content.trim())) { toastr.info('No changes were accepted. The source range stays pending.'); return false; }
    await commit(plan, parsed, s.lorebook, Memory.bookHash(data));
    return { days: plan.adds.filter(a => a.include).map(e => e.dayNum).filter(n => Number.isInteger(n)) };
}

/** First run with no lorebook picked: make one named after the character, select it and attach it to the chat. */
async function ensureLorebook() {
    const s = settings();
    if (s.lorebook) return true;
    const base = `${getContext().name2 || 'Story'} Archive`;
    let name = base, i = 2;
    while (getContext().getWorldInfoNames().includes(name)) name = `${base} ${i++}`;
    if (!(await createNewWorldInfo(name))) { toastr.error('Could not create a lorebook.'); return false; }
    await updateWorldInfoList();
    await refreshLorebookList(name);
    if (!isLorebookActive(name)) { chat_metadata[METADATA_KEY] = name; try { await saveMetadata(); } catch { /* ignore */ } $('.chat_lorebook_button').addClass('world_set'); }
    saveSettingsDebounced();
    toastr.info(`Created "${name}" and attached it to this chat.`);
    return true;
}

async function runSummarize(opts = {}) {
    if (workbench) {
        try { return await workbench.archiveWorkflow(opts?.thorough === true); }
        catch (e) { console.error(LOG, e); toastr.error(e?.message ?? e); return false; }
    }
    const thorough = opts?.thorough === true;
    if (busy) { toastr.info('The archivist is already running.'); return; }
    if (!(getContext().chat?.length)) { toastr.warning('Open a chat first.'); return; }
    if (!(await ensureLorebook())) return;
    const startingChat = getContext().chat, startingRevision = chatRevision;
    const s = settings();
    busy = true; operationChat = getContext().chat; operationRevision = chatRevision;
    let wrote = false;
    $('.sa-run').prop('disabled', true);
    const note = toastr.info('Running your archivist prompt. This can take a minute.', 'Scene Archivist', { timeOut: 0, extendedTimeOut: 0 });
    try {
        if (s.archiveMode === 'chat') {
            let prompt = s.prompt;
            if (s.appendLog) {
                const data = await loadWorldInfo(s.lorebook);
                const log = data ? Core.currentLogText(data) : '';
                if (log) prompt += '\n\n---\n\nCURRENT SCENE LOG (always-on part):\n\n' + log;
            }
            const range = pendingRange();
            const out = await generateQuietPrompt({ quietPrompt: prompt, responseLength: Number(s.maxTokens) > 0 ? Number(s.maxTokens) : null });
            toastr.clear(note);
            if (!out || !out.trim()) { toastr.error('The model returned nothing.'); return; }
            const res = await handleOutput(out);
            wrote = !!res;
            if (res && range) await afterArchive(range, res.days);
        } else {
            toastr.clear(note);
            wrote = await runPasses();
        }
    } catch (e) {
        console.error(LOG, e);
        toastr.error('Archivist failed: ' + (e?.message ?? e));
    } finally {
        try { toastr.clear(note); } catch { /* ignore */ }
        busy = false; operationChat = null;
        $('.sa-run').prop('disabled', false);
    }
    if ((getContext().chat !== startingChat || chatRevision !== startingRevision)) return wrote;
    if (wrote && (settings().memoryAuto || thorough)) await runMemories(true);
    if ((getContext().chat !== startingChat || chatRevision !== startingRevision)) return wrote;
    if (wrote && (settings().trackerAuto || thorough)) await runTrackers(null, true);
    if (getContext().chat === startingChat && chatRevision === startingRevision && wrote && thorough) await runCondense(true);
    return wrote;
}

async function pasteOutput() {
    const text = await callGenericPopup('Paste the archivist output here', POPUP_TYPE.INPUT, '', { rows: 18, wide: true, large: true, okButton: 'Parse' });
    if (!text || typeof text !== 'string' || !text.trim()) return;
    if (busy) return;
    busy = true; operationChat = getContext().chat; operationRevision = chatRevision;
    const startingChat = getContext().chat, startingRevision = chatRevision;
    let wrote = false;
    try { wrote = !!(await handleOutput(text)); } catch (e) { console.error(LOG, e); toastr.error('Failed: ' + (e?.message ?? e)); } finally { busy = false; operationChat = null; }
    if ((getContext().chat !== startingChat || chatRevision !== startingRevision)) return;
    if (wrote && settings().memoryAuto) await runMemories(true);
    if ((getContext().chat !== startingChat || chatRevision !== startingRevision)) return;
    if (wrote && settings().trackerAuto) await runTrackers(null, true);
}

// ---------------------------------------------------------------- side calls (keywords, recall, memories, condense)

let sideWarned = false;
const issues = [];
const noteIssue = (msg) => { issues.push(`${new Date().toISOString().slice(11, 19)} ${msg}`); if (issues.length > 12) issues.shift(); };

/** Ask for JSON; if the reply cannot be parsed, ask once more, firmly. Returns {value, text}. */
async function sideJson(req, parse, label) {
    let text = await sideCall(req);
    let value = parse(text);
    if (value == null) {
        noteIssue(`${label}: first reply was not usable JSON, retrying`);
        text = await sideCall({ ...req, prompt: req.prompt + '\n\nYour previous reply could not be read. Reply again with ONLY the JSON object, no commentary and no code fences.' });
        value = parse(text);
        if (value == null) noteIssue(`${label}: retry also failed`);
    }
    return { value, text };
}

async function copyDiagnostics() {
    const s = settings(); const ctx = getContext();
    const data = s.lorebook ? await loadWorldInfo(s.lorebook).catch(() => null) : null;
    const entries = data ? Object.values(data.entries ?? {}) : [];
    const m = chat_metadata?.[KEY] ?? {};
    const lines = [
        `Scene Archivist ${VERSION}`,
        `SillyTavern: ${typeof ctx.version === 'string' ? ctx.version : 'unknown'} | API: ${main_api} | ${navigator.userAgent}`,
        `Delivery: ${s.delivery} (depth ${s.depth}, role ${s.role}, outlet "${s.outlet}") | Archive mode: ${s.archiveMode} | Keywords: ${s.keyMode}`,
        `Side-call profile: ${s.sideProfile || '(current model)'} | Recall: ${s.recall ? 'on' : 'off'} | Memories auto: ${s.memoryAuto ? 'on' : 'off'} (${s.memoryTarget}${s.memoryTarget === 'separate' ? ', book "' + memoryBookName() + '", active: ' + (selected_world_info.includes(memoryBookName()) ? 'yes' : 'no') : ''})`,
        `Lorebook: ${s.lorebook || '(none)'} | entries: ${entries.length} | attached to chat: ${isLorebookActive(s.lorebook) ? 'yes' : 'no'}`,
        `Prompt: ${s.promptId} (${String(s.prompt ?? '').length} chars) | pass size ${s.chunkTokens} | auto-hide ${s.hideArchived ? 'on, keep ' + s.keepVisible : 'off'}`,
        `Chat: ${(ctx.chat ?? []).length} messages | archived through ${m.archivedThrough ?? 'none'} | ranges ${(m.ranges ?? []).length}`,
        `Recent issues:${issues.length ? '\n  ' + issues.join('\n  ') : ' none'}`,
    ];
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); toastr.success('Diagnostics copied to the clipboard.'); }
    catch { await callGenericPopup(text, POPUP_TYPE.TEXT, '', { wide: true, large: true }); }
}

/** Small helper requests use a Connection Manager profile when one is chosen, otherwise the current model. */
async function sideCall({ prompt, system = '', maxTokens = 1200 }) {
    const s = settings();
    if (s.sideProfile) {
        try {
            const svc = getContext().ConnectionManagerRequestService;
            if (!svc) throw new Error('Connection Manager is not available');
            const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
            const res = await svc.sendRequest(s.sideProfile, messages, maxTokens);
            const text = typeof res === 'string' ? res : res?.content;
            if (text && String(text).trim()) return String(text);
            throw new Error('empty reply');
        } catch (e) {
            console.warn(LOG, 'side profile failed, using the current model', e);
            if (!sideWarned) { sideWarned = true; toastr.warning('The chosen side-call profile failed (' + (e?.message ?? e) + '), so the current model is being used instead.'); }
        }
    }
    return await generateRaw({ prompt, systemPrompt: system, responseLength: maxTokens });
}

function refreshProfileList() {
    const s = settings();
    const sel = $('#sa_side_profile'); if (!sel.length) return;
    const profiles = getContext().extensionSettings?.connectionManager?.profiles ?? [];
    sel.empty().append('<option value="">(current model)</option>');
    for (const p of profiles) sel.append($('<option>').val(p.id).text(p.name));
    if (s.sideProfile && !profiles.some(p => p.id === s.sideProfile)) s.sideProfile = '';
    sel.val(s.sideProfile);
}

async function testSide() {
    try {
        const out = await sideCall({ prompt: 'Reply with the single word: ready', maxTokens: 30 });
        toastr.success('The side model answered: ' + String(out).trim().slice(0, 60), 'Side-call test');
    } catch (e) { toastr.error('The side model failed: ' + (e?.message ?? e)); }
}

// ---------------------------------------------------------------- what the model saw

let lastView = null;
const fmtTok = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

async function onWorldInfoActivated(entries) {
    try {
        if (busy) return;
        workbench?.onWorldInfoActivated(entries);
        const items = [];
        const decision = workbench?.lastBudget;
        const selected = new Set((decision?.accepted || []).map(c => c.id));
        const candidates = new Map([...(decision?.accepted || []), ...(decision?.omitted || [])].map(c => [c.id, c]));
        for (const e of entries ?? []) {
            const cl = Core.classifyEntry(e);
            if (!cl) continue;
            const tokens = await getTokenCountAsync(String(e.content ?? ''));
            const id = Memory.record(workbench?.findRetrievedEntry(e) || e)?.id;
            const candidate = candidates.get(id), triggers = [...(candidate?.reasons || [])];
            if (workbench?.semanticHits.has(id) && !triggers.includes('native vector')) triggers.push('native vector');
            if (!candidate) {
                if (e.constant) triggers.push('always on');
                if (held.has(e.uid) && e.world === settings().lorebook) triggers.push('recall');
            }
            const evidence = triggers.length ? entryReasons({ ...candidate, reasons: triggers }) : 'World Info activation';
            const reason = candidate && !selected.has(id) ? 'Outside managed selection: ' + evidence : evidence;
            items.push({ title: e.comment || cl.heading || cl.type, tokens, reason, triggers, type: cl.type });
        }
        lastView = { at: Date.now(), items };
        await renderView();
    } catch (e) { console.warn(LOG, 'viewer', e); }
}

async function renderView() {
    const sum = $('#sa_view_sum'); const list = $('#sa_view_list');
    if (!sum.length) return;
    if (!lastView) { sum.text('Send a normal chat reply to see World Info activations and their recorded selection reasons.'); list.empty(); return; }
    const by = (r) => lastView.items.filter(i => i.triggers.includes(r)).reduce((n, i) => n + i.tokens, 0);
    const total = lastView.items.reduce((n, i) => n + i.tokens, 0);
    const ctx = Number(getContext().maxContext) || 0;
    sum.text(`Last World Info scan: ${lastView.items.length} archive entries, about ${fmtTok(total)} tokens${ctx ? ` (${Math.round(total / ctx * 100)}% of the ${fmtTok(ctx)} context)` : ''}. Text matches ${fmtTok(by('query match'))}, vector matches ${fmtTok(by('native vector'))}, always on ${fmtTok(by('always on'))}, AI Recall ${fmtTok(by('recall'))}. Reasons can overlap.`);
    list.html(lastView.items.map(i => `<div class="sa-viewrow"><span class="sa-badge">${esc(i.reason)}</span> ${esc(i.title)} <span class="sa-hint">${fmtTok(i.tokens)}</span></div>`).join(''));
}

// ---------------------------------------------------------------- condense memories

async function showCondenseReview(results) {
    const root = document.createElement('div');
    root.className = 'sa-review';
    root.innerHTML = `<h3>Condense memories</h3><div class="sa-note">${results.length} ${results.length === 1 ? 'character' : 'characters'}. Edit the new list if you like, one memory per line. Untick a character to leave them as they are. The original is shown below each list.</div>`;
    const refs = [];
    for (const r of results) {
        const d = document.createElement('details'); d.open = true;
        d.innerHTML = `<summary><input type="checkbox" checked><b>${esc(r.name)}</b><span class="sa-badge">${r.before.length} to ${r.bullets.length} memories in ${esc(r.book)}</span></summary>`;
        if (r.suspicious) d.insertAdjacentHTML('beforeend', '<div class="sa-warnline">▲ This cuts the list a lot. Check that nothing important was lost.</div>');
        d.insertAdjacentHTML('beforeend', '<textarea class="text_pole" rows="8"></textarea><details><summary>Original</summary><textarea class="text_pole sa-orig" rows="8" readonly></textarea></details>');
        d.querySelector('textarea').value = r.bullets.join('\n');
        d.querySelector('.sa-orig').value = r.before.join('\n');
        root.append(d); refs.push({ r, d });
    }
    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: 'Apply', cancelButton: 'Cancel', wide: true, large: true, allowVerticalScrolling: true });
    if ((await popup.show()) !== POPUP_RESULT.AFFIRMATIVE) return false;
    for (const { r, d } of refs) { r.include = d.querySelector('input[type=checkbox]').checked; r.bullets = d.querySelector('textarea').value.split('\n').map(x => x.replace(/^[-*]\s*/, '').trim()).filter(Boolean); }
    return true;
}

async function runCondense(quiet = false) {
    if (workbench) { try { return await workbench.startMemoryCondense(quiet); } catch (e) { toastr.error(e?.message ?? e); return; } }
    if (busy) { toastr.info('The archivist is already running.'); return; }
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick or create a lorebook first.'); return; }
    busy = true; operationChat = getContext().chat; operationRevision = chatRevision;
    $('.sa-cond-run').prop('disabled', true);
    let note = null;
    try {
        const names = getContext().getWorldInfoNames();
        const books = new Set([s.lorebook]);
        if (names.includes(memoryBookName())) books.add(memoryBookName()); // the separate memories lorebook
        for (const book of Object.keys(s.storyBooks?.[s.lorebook] ?? {})) if (names.includes(book)) books.add(book);
        const above = Math.max(2, Number(s.condenseAbove) || 12);
        const archiveData = await loadWorldInfo(s.lorebook);
        const dates = archiveData ? Core.selectMemorySource(archiveData, 0, 1).dates : {}; // models tend to drop the dates, so they are put back from the log
        const jobs = [];
        for (const book of books) {
            const data = await loadWorldInfo(book); if (!data) continue;
            for (const m of Core.memoryEntries(storyMemoryData(data, book), s.unit || 'Day')) if (m.bullets.length > above) jobs.push({ book, data, ...m });
        }
        if (!jobs.length) { if (quiet === true) return; toastr.info(`No character has more than ${above} memories in ${[...books].map(b => '"' + b + '"').join(', ')}. Lower "Condense above" to try a shorter list.`); return; }
        note = toastr.info(`Condensing ${jobs.length} ${jobs.length === 1 ? 'list' : 'lists'}.`, 'Scene Archivist', { timeOut: 0, extendedTimeOut: 0 });
        const results = [];
        for (const j of jobs) {
            try {
                const req = Core.buildCondenseRequest(Core.unitize(s.condensePrompt, s.unit), j.name, j.bullets);
                const res = (await sideJson({ prompt: req.prompt, system: req.system, maxTokens: 2500 }, t => Core.parseCondenseResponse(t, j.bullets), 'condense')).value;
                if (res) results.push({ ...j, before: j.bullets, bullets: res.bullets, suspicious: res.suspicious, include: true });
                else console.warn(LOG, 'unusable condense reply for', j.name);
            } catch (e) { console.warn(LOG, 'condense failed for', j.name, e); }
        }
        toastr.clear(note); note = null;
        if (!results.length) { toastr.warning('The model did not return a usable shorter list for anyone.'); return; }
        if (!(await showCondenseReview(results))) { toastr.info('Cancelled. Nothing was changed.'); return; }
        const touched = [];
        const byBook = new Map();
        for (const r of results) { if (!r.include || !r.bullets.length) continue; if (!byBook.has(r.book)) byBook.set(r.book, []); byBook.get(r.book).push(r); }
        let n = 0;
        beginUndoWrite();
        for (const [book, list] of byBook) {
            assertCurrentChat();
            const data = await loadWorldInfo(book);
            if (!data) throw new Error(`Could not reload ${book}.`);
            await saveUndoSnapshot(book, data);
            for (const r of list) if (Core.applyCondense(data, r.uid, r.bullets, { dates, unit: s.unit || 'Day' })) n++;
            await saveWorldInfo(book, data, true);
            try { reloadEditor(book); } catch { /* editor closed */ }
            touched.push(book);
        }
        if (touched.length) { s.lastWriteBooks = touched; saveSettingsDebounced(); }
        await updateInfoLine();
        toastr.success(n ? `Condensed ${n} memory ${n === 1 ? 'list' : 'lists'}.` : 'Nothing was changed.');
    } catch (e) {
        console.error(LOG, e);
        toastr.error('Condense failed: ' + (e?.message ?? e));
    } finally {
        if (note) try { toastr.clear(note); } catch { /* ignore */ }
        busy = false; operationChat = null;
        $('.sa-cond-run').prop('disabled', false);
    }
}

// ---------------------------------------------------------------- archive ledger, passes and hiding

const meta = () => (chat_metadata[KEY] ??= {});

function pendingRange() {
    const chat = getContext().chat ?? [];
    const p = Core.pendingMessages(chat, meta());
    return p.length ? { ranges: Core.splitPasses(p, Infinity).map(p => ({ from: p.from, to: p.to })) } : null;
}

async function afterArchive(range, days, hideOverride = null) {
    assertCurrentChat();
    const s = settings();
    const chat = getContext().chat ?? [];
    for (const r of range.ranges ?? [range]) {
        let hidden = false, hiddenTo = null;
        if (range.stepId && meta().ranges?.some(x => x.stepId === range.stepId && x.from === r.from && x.to === r.to)) continue;
        if (hideOverride ?? s.hideArchived) {
            const keep = hideOverride != null ? 0 : Math.max(0, Number(s.keepVisible) || 0);
            const hideTo = Math.min(r.to, chat.length - 1 - keep);
            if (hideTo >= r.from) { await hideChatMessageRange(r.from, hideTo, false); hidden = true; hiddenTo = hideTo; }
        }
        assertCurrentChat();
        chat_metadata[KEY] = Core.ledgerAdd(chat_metadata[KEY] ?? {}, { from: r.from, to: r.to, days, hidden, hiddenTo });
        if (range.stepId) chat_metadata[KEY].ranges.at(-1).stepId = range.stepId;
        chat_metadata[KEY].ranges.at(-1).source = Memory.sourceSnapshot(workbench?.state().storyId || '', chat, [r]);
    }
    await saveMetadata();
    await renderLedger();
}

async function toggleLedgerRow(i) {
    if (busy) { toastr.info('Wait for the current operation to finish.'); return; }
    const m = meta(); const r = m.ranges?.[i]; if (!r) return;
    const chat = getContext().chat ?? [];
    const anyVisible = chat.slice(r.from, r.to + 1).some(x => !x.is_system);
    if (!anyVisible) { await hideChatMessageRange(r.from, Math.min(r.to, chat.length - 1), true); r.hidden = false; }
    else { const to = Math.min(r.to, chat.length - 1); await hideChatMessageRange(r.from, to, false); r.hidden = true; r.hiddenTo = to; }
    try { await saveMetadata(); } catch { /* ignore */ }
    await renderLedger();
}

async function renderLedger() {
    const sum = $('#sa_ledger_sum'); const list = $('#sa_ledger');
    if (!sum.length) return;
    const chat = getContext().chat ?? [];
    const m = chat_metadata?.[KEY] ?? {};
    const pend = Core.pendingMessages(chat, m);
    const tok = pend.reduce((n, x) => n + Core.estimateTokens(x.text), 0);
    const through = m.archivedThrough ?? -1;
    const passes = Core.splitPasses(pend, Number(settings().chunkTokens) || 12000).length;
    sum.text(through >= 0
        ? `Continuous coverage: messages 0 to ${through}${m.lastDay ? ` (${settings().unit} ${m.lastDay})` : ''}. ${pend.length} messages remain unarchived${pend.length ? ` (about ${fmtTok(tok)} tokens, ${passes} passes)` : ''}.`
        : `${Core.archivedRanges(m).length ? 'Some ranges are archived; earlier gaps remain.' : 'Nothing archived in this chat yet.'} ${pend.length} messages (about ${fmtTok(tok)} tokens, ${passes} ${passes === 1 ? 'pass' : 'passes'}).`);
    const rows = Core.ledgerRows(m);
    list.html(rows.map(r => { const row = m.ranges[r.i]; const visible = chat.slice(row.from, row.to + 1).filter(x => !x.is_system).length; return `<div class="sa-ledgerrow"><b>Messages ${esc(r.label)}</b> <span class="sa-badge">summarized</span> <span class="sa-hint">${visible} visible / ${row.to - row.from + 1} total · ${esc(r.note.replace(/Day/g, settings().unit))}</span> <a class="sa-ledgerlink" data-i="${r.i}">${visible ? 'hide exactly this range' : 'show exactly this range'}</a></div>`; }).join('') || '<div class="sa-hint">No summarized ranges yet. Use Pick your messages for an exact interval.</div>');
    list.find('.sa-ledgerlink').on('click', async function () { await toggleLedgerRow(Number($(this).data('i'))); });
}

async function setThrough() {
    if (busy) return;
    const n = Number($('#sa_through').val());
    const chat = getContext().chat ?? [];
    if (!Number.isInteger(n) || n < 0 || n >= chat.length) { toastr.warning(`Type a message number between 0 and ${chat.length - 1}.`); return; }
    const m = meta();
    const allHidden = chat.slice(0, n + 1).every(x => x.is_system);
    m.archivedThrough = n;
    m.ranges = [{ from: 0, to: n, days: [], hidden: allHidden, hiddenTo: allHidden ? n : null, note: 'marked by hand' }];
    try { await saveMetadata(); } catch { /* ignore */ }
    await renderLedger();
    toastr.success(`Messages 0 to ${n} are now marked as archived.`);
}

async function importLedger() {
    if (busy) return;
    const text = await callGenericPopup('Paste your list, one range per line. Struck-through lines (~~0-8 Tuesday, October 6, 2026~~) count as archived, plain lines as not archived yet.', POPUP_TYPE.INPUT, '', { rows: 14, wide: true, large: true, okButton: 'Import' });
    if (!text || typeof text !== 'string') return;
    const rows = Core.parseLedgerList(text);
    if (!rows.length) { toastr.error('I could not find any "from-to" ranges in that list.'); return; }
    const chat = getContext().chat ?? [];
    const archived = rows.filter(r => r.archived && r.from < chat.length);
    const m = meta();
    m.ranges = archived.map(r => {
        const to = Math.min(r.to, chat.length - 1);
        const allHidden = chat.slice(r.from, to + 1).every(x => x.is_system);
        return { from: r.from, to, days: [], hidden: allHidden, hiddenTo: allHidden ? to : null, note: r.note };
    });
    m.archivedThrough = Core.coverageThrough(m);
    try { await saveMetadata(); } catch { /* ignore */ }
    await renderLedger();
    toastr.success(`Imported ${archived.length} archived ${archived.length === 1 ? 'range' : 'ranges'}. Archived through message ${m.archivedThrough}.`);
}

/** Archive the transcript of the not-yet-archived messages in passes, writing and reviewing after each pass. */
async function runPasses() {
    const s = settings();
    const chat = getContext().chat ?? [];
    const num = (sel) => { const v = String($(sel).val() ?? '').trim(); return v === '' ? null : Number(v); };
    const pend = Core.pendingMessages(chat, meta(), { from: num('#sa_range_from'), to: num('#sa_range_to') });
    if (!pend.length) { toastr.info('There is nothing new to archive.'); return false; }
    const passes = Core.splitPasses(pend, Math.max(2000, Number(s.chunkTokens) || 12000));
    let wroteAny = false;
    for (let i = 0; i < passes.length; i++) {
        assertCurrentChat();
        const pass = passes[i];
        const note = toastr.info(`Pass ${i + 1} of ${passes.length}: messages ${pass.from} to ${pass.to} (about ${fmtTok(pass.tokens)} tokens).`, 'Scene Archivist', { timeOut: 0, extendedTimeOut: 0 });
        let out = '';
        try {
            const data = (await loadWorldInfo(s.lorebook)) ?? { entries: {} };
            const req = Core.buildArchivistRequest(s.prompt, Core.currentLogText(data), Core.buildTranscript(pass.messages), { from: pass.from, to: pass.to }, s.unit || 'Day');
            out = await generateRaw({ prompt: req.prompt, systemPrompt: req.system, responseLength: Number(s.maxTokens) > 0 ? Number(s.maxTokens) : 6000 });
        } finally { try { toastr.clear(note); } catch { /* ignore */ } }
        if (!out || !out.trim()) { noteIssue('archive pass ' + (i + 1) + ' returned nothing'); toastr.error('The model returned nothing for pass ' + (i + 1) + '.'); break; }
        const res = await handleOutput(out);
        if (!res) { if (i < passes.length - 1) toastr.info('Stopped. The remaining passes were not run.'); break; }
        wroteAny = true;
        await afterArchive({ from: pass.from, to: pass.to }, res.days);
    }
    return wroteAny;
}

// ---------------------------------------------------------------- prompt library, exports

function builtinTexts() {
    return BUILTIN_PROMPTS.map(b => ({ ...b, text: b.id === 'keyevents' ? DEFAULT_PROMPT_KEY_EVENTS : Core.unitize(DEFAULT_PROMPT, b.unit) }));
}
const promptItems = () => Core.promptList(builtinTexts(), settings().promptLibrary);

function renderPromptLib() {
    const s = settings();
    const items = promptItems();
    if (!items.some(p => p.id === s.promptId)) s.promptId = items[0].id;
    $('#sa_pl_sel').html(items.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.builtin ? '' : ' (custom)'}${p.modified ? ' (edited)' : ''}</option>`).join('')).val(s.promptId);
    const cur = items.find(p => p.id === s.promptId);
    $('#sa_pl_name').val(cur.name).prop('disabled', cur.builtin);
    $('#sa_pl_reset').prop('disabled', !cur.modified);
    $('#sa_pl_del').prop('disabled', cur.builtin);
    s.prompt = cur.text; $('#sa_prompt').val(cur.text);
    const unitSelect = $('#sa_unit');
    unitSelect.html(Core.UNITS.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('') + '<option value="__custom">Custom unit...</option>').val(s.unit);
    $('#sa_custom_unit').val(s.unit);
    workbench?.updateUnitLabels();
}

function savePromptText(text) {
    const s = settings();
    s.prompt = text;
    const lib = s.promptLibrary;
    const cur = promptItems().find(p => p.id === s.promptId);
    const at = lib.findIndex(p => p.id === s.promptId);
    if (at >= 0) { lib[at].text = text; lib[at].unit = s.unit; } else lib.push({ id: s.promptId, name: cur.name, text, unit: s.unit });
    saveSettingsDebounced();
    const builtin = builtinTexts().find(b => b.id === s.promptId);
    $('#sa_pl_reset').prop('disabled', !(builtin && builtin.text !== text));
}

function addPrompt(name, text, unit = settings().unit) {
    const s = settings();
    const id = 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    s.promptLibrary.push({ id, name, text, unit }); s.promptId = id; s.unit = unit;
    saveSettingsDebounced(); renderPromptLib();
}

function promptSelect() {
    const s = settings(); s.promptId = String($('#sa_pl_sel').val());
    const b = promptItems().find(x => x.id === s.promptId); if (b?.unit) s.unit = b.unit;
    saveSettingsDebounced(); renderPromptLib();
}
function promptRename() {
    const s = settings(); const at = s.promptLibrary.findIndex(p => p.id === s.promptId);
    if (at < 0 || BUILTIN_PROMPTS.some(b => b.id === s.promptId)) return;
    s.promptLibrary[at].name = String($('#sa_pl_name').val()).slice(0, 60) || 'My prompt'; saveSettingsDebounced();
    $('#sa_pl_sel option:selected').text(s.promptLibrary[at].name + ' (custom)');
}
function promptNew() { addPrompt('My prompt', DEFAULT_PROMPT); }
function promptDuplicate() { const cur = promptItems().find(p => p.id === settings().promptId); addPrompt(cur.name + ' copy', $('#sa_prompt').val()); }
function promptDelete() {
    const s = settings(); if (BUILTIN_PROMPTS.some(b => b.id === s.promptId)) return;
    s.promptLibrary = s.promptLibrary.filter(p => p.id !== s.promptId); s.promptId = 'scenelog';
    saveSettingsDebounced(); renderPromptLib();
}
function promptReset() {
    const s = settings(); s.promptLibrary = s.promptLibrary.filter(p => p.id !== s.promptId);
    saveSettingsDebounced(); renderPromptLib(); toastr.info('Prompt reset to the built-in version.');
}

function downloadFile(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
}
function promptExport() {
    const cur = promptItems().find(p => p.id === settings().promptId);
    downloadFile(`${cur.name.replace(/[^\w\- ]+/g, '').trim() || 'prompt'}.archivist-prompt.json`, Core.exportPrompt({ name: cur.name, text: $('#sa_prompt').val(), unit: settings().unit }), 'application/json');
}
function promptImportFile(file) {
    const r = new FileReader();
    r.onload = () => {
        const p = Core.parsePromptImport(r.result);
        if (!p) { toastr.error('That file is not a Scene Archivist prompt.'); return; }
        addPrompt(p.name, p.text, p.unit); toastr.success(`Imported "${p.name}".`);
    };
    r.readAsText(file);
}

async function exportLogMd() {
    const s = settings();
    const data = s.lorebook ? await loadWorldInfo(s.lorebook) : null;
    if (!data) { toastr.warning('Pick a lorebook first.'); return; }
    const md = Core.exportLogMarkdown(data);
    if (!md.trim()) { toastr.info('The log is empty.'); return; }
    downloadFile(`${s.lorebook} scene log.md`, md, 'text/markdown');
}

// ---------------------------------------------------------------- Character memories

function findCharacter(c) {
    const names = [c.name, ...(c.aliases ?? [])].map(x => String(x).toLowerCase());
    return (characters ?? []).find(ch => ch?.name && names.includes(String(ch.name).toLowerCase()));
}

const memoryBookName = () => { const s = settings(); return (String(s.memoryBook ?? '').trim() || `${s.lorebook} Memories`).slice(0, 80); };

/** Which lorebook a character's memories go to: a separate memories lorebook, the archive, or the character's own lorebook. */
function memoryBookFor(c) {
    const s = settings();
    if (s.memoryTarget === 'archive') return s.lorebook;
    if (s.memoryTarget === 'character') {
        const w = findCharacter(c)?.data?.extensions?.world;
        if (w && getContext().getWorldInfoNames().includes(w)) return w;
    }
    return memoryBookName();
}

/** Register only books explicitly associated with this archive. */
function registerStoryBook(archive, book, kind) {
    if (!archive || !book) return;
    const s = settings();
    if (kind !== 'character') {
        const owner = Object.entries(s.storyBooks).find(([other, books]) => other !== archive && books[book] && books[book] !== 'character');
        if (owner) throw new Error(`"${book}" belongs to archive "${owner[0]}". Choose a different book for this story.`);
    }
    (s.storyBooks[archive] ??= {})[book] = kind;
    saveSettingsDebounced();
}

function storyMemoryData(data, book) {
    const s = settings();
    const otherOwner = Object.entries(s.storyBooks).some(([owner, books]) => owner !== s.lorebook && books[book] && books[book] !== 'character');
    if (otherOwner) return { ...data, entries: {} };
    const dedicated = book === s.lorebook || book === memoryBookName() || s.storyBooks[s.lorebook]?.[book] === 'separate';
    return { ...data, entries: Object.fromEntries(Object.entries(data.entries ?? {}).filter(([, e]) =>
        e.sceneArchivistArchive ? e.sceneArchivistArchive === s.lorebook : dedicated)) };
}

async function onEntriesLoaded(groups) {
    const s = settings();
    const archive = s.lorebook;
    const sources = ['globalLore', 'characterLore', 'chatLore', 'personaLore'];
    for (const key of sources) {
        const entries = groups[key];
        if (!Array.isArray(entries)) continue;
        for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i];
            const owner = e.sceneArchivistArchive || Object.entries(s.storyBooks).find(([, books]) =>
                books[e.world] && books[e.world] !== 'character')?.[0];
            const kind = Core.classifyEntry(e);
            const unscopedMemory = kind?.type === 'memory' && !owner && e.world !== archive && e.world !== memoryBookName();
            if ((owner && owner !== archive && kind) || unscopedMemory) entries.splice(i, 1);
        }
    }
    if (!archive || !isLorebookActive(archive) || !Array.isArray(groups.chatLore)) return;
    const seen = new Set(sources.flatMap(k => groups[k] ?? []).map(e => `${e.world}::${e.uid}`));
    const books = new Set([memoryBookName(), ...Object.keys(s.storyBooks[archive] ?? {})]);
    for (const book of books) {
        if (book === archive || !getContext().getWorldInfoNames().includes(book)) continue;
        const data = await loadWorldInfo(book);
        if (settings().lorebook !== archive) return;
        for (const e of Object.values(storyMemoryData(data ?? {}, book).entries ?? {})) {
            if ((!Memory.record(e) && Core.classifyEntry(e)?.type !== 'memory') || e.disable || seen.has(`${book}::${e.uid}`)) continue;
            groups.chatLore.push({ ...e, world: book });
            seen.add(`${book}::${e.uid}`);
        }
    }
    if (workbench) await workbench.filterEntries(groups);
}

async function refreshChatUi() {
    const s = settings();
    held.clear(); lastView = null; lastRemindAt = 0;
    $('#sa_range_from, #sa_range_to').val('');
    $('#sa_mem_book').val(s.memoryBook); $('#sa_mem_target').val(s.memoryTarget);
    $('#sa_mem_from').val(s.memoryFrom); $('#sa_mem_to').val(s.memoryTo);
    if (s.lorebook) {
        registerStoryBook(s.lorebook, s.lorebook, 'archive');
        const book = memoryBookName();
        if (getContext().getWorldInfoNames().includes(book)) registerStoryBook(s.lorebook, book, 'separate');
    }
    await refreshLorebookList();
    await saveMetadata();
    await renderLedger(); await renderView();
    if (workbench) await workbench.onChatOpened();
}

function migrateStoryBooks() {
    const s = settings();
    const names = getContext().getWorldInfoNames();
    // Known legacy archives and their conventional memory books can be scoped without guessing character ownership.
    const old = extension_settings[KEY];
    for (const archive of new Set([old.lorebook, ...Object.keys(s.memoryProgress ?? {})].filter(Boolean))) {
        if (names.includes(archive)) registerStoryBook(archive, archive, 'archive');
        const book = archive === old.lorebook && old.memoryBook ? old.memoryBook : `${archive} Memories`.slice(0, 80);
        if (book !== archive && names.includes(book)) registerStoryBook(archive, book, 'separate');
    }
}

async function showMemoryReview(plans, src) {
    const root = document.createElement('div');
    root.className = 'sa-review';
    const total = plans.reduce((n, p) => n + p.items.length, 0);
    root.innerHTML = `<h3>Character memories from Day ${esc(src.days.join(', '))}</h3><div class="sa-note">${total} ${total === 1 ? 'character' : 'characters'}. Edit anything, one memory per line. Untick a character to skip them.</div>`;
    const refs = [];
    for (const p of plans) for (const it of p.items) {
        const d = document.createElement('details'); d.open = true;
        d.innerHTML = `<summary><input type="checkbox" checked><b>${esc(it.name)}</b><span class="sa-badge">${it.uid == null ? 'new entry' : 'adds to existing'} in ${esc(p.book)}</span></summary>`;
        if (it.warn) d.insertAdjacentHTML('beforeend', `<div class="sa-warnline">▲ ${esc(it.warn)}</div>`);
        d.insertAdjacentHTML('beforeend', `<div class="sa-note">Keywords, comma separated. The memory loads when one appears in the recent chat${p.own ? ' (this entry is always on inside the character\'s own lorebook)' : ''}.</div><input class="text_pole sa-keys" type="text"><textarea class="text_pole" rows="6"></textarea>`);
        d.querySelector('.sa-keys').value = it.keys.join(', ');
        d.querySelector('textarea').value = it.bullets.join('\n');
        root.append(d);
        refs.push({ it, d });
    }
    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: 'Write memories', cancelButton: 'Cancel', wide: true, large: true, allowVerticalScrolling: true });
    if ((await popup.show()) !== POPUP_RESULT.AFFIRMATIVE) return false;
    for (const { it, d } of refs) {
        it.include = d.querySelector('input[type=checkbox]').checked;
        it.keys = Core.withVariants(d.querySelector('.sa-keys').value.split(',').map(x => x.trim()).filter(Boolean));
        it.bullets = d.querySelector('textarea').value.split('\n').map(x => x.trim()).filter(Boolean);
    }
    return true;
}

async function commitMemories(plans, src) {
    const s = settings(); const o = coreOpts();
    const touched = [];
    let created = 0, updated = 0;
    beginUndoWrite();
    for (const p of plans) {
        if (!p.items.some(i => i.include && i.bullets.length)) continue;
        assertCurrentChat();
        registerStoryBook(s.lorebook, p.book, p.own ? 'character' : (p.book === s.lorebook ? 'archive' : 'separate'));
        if (!getContext().getWorldInfoNames().includes(p.book)) {
            if (!(await createNewWorldInfo(p.book))) throw new Error(`Could not create the lorebook "${p.book}".`);
            await updateWorldInfoList();
        }
        assertCurrentChat();
        p.data = (await loadWorldInfo(p.book)) ?? { entries: {} };
        await saveUndoSnapshot(p.book, p.data);
        const untouched = clone(p.data.entries ?? {});
        const rep = Core.applyMemories(p.data, p.items.filter(i => i.bullets.length), o, (d) => createWorldInfoEntry(p.book, d), { constant: p.own, dates: src.dates, unit: s.unit || 'Day' });
        const accepted = p.items.filter(i => i.include && i.bullets.length);
        for (const e of Object.values(p.data.entries ?? {})) {
            const cl = Core.classifyEntry(e);
            if (cl?.type === 'memory' && accepted.some(i => i.uid === e.uid || (i.uid == null && !(e.uid in untouched) && i.name === cl.name))) e.sceneArchivistArchive = s.lorebook;
            else if (e.uid in untouched) p.data.entries[e.uid] = untouched[e.uid];
        }
        await saveWorldInfo(p.book, p.data, true);
        try { reloadEditor(p.book); } catch { /* editor closed */ }
        touched.push(p.book); created += rep.created.length; updated += rep.updated.length;
    }
    assertCurrentChat();
    if (plans.every(p => p.items.every(i => i.include && i.bullets.length))) s.memoryProgress = { ...(s.memoryProgress ?? {}), [s.lorebook]: Math.max(Number(s.memoryProgress?.[s.lorebook] ?? 0), src.lastDay) };
    if (touched.length) s.lastWriteBooks = touched;
    saveSettingsDebounced();
    await updateInfoLine();
    toastr.success(touched.length ? `Memories saved: ${created} new, ${updated} updated${touched.length > 1 ? ` across ${touched.length} lorebooks` : ''}.` : 'Nothing was written.');
}

/** One batch of Days. Returns {ok, remaining, lastDay}; ok is false when nothing was done or the user cancelled. */
async function memoryStep(range, first) {
    const s = settings();
    let note = null;
    try {
        const data = await loadWorldInfo(s.lorebook);
        if (!data) { toastr.error('Could not load the lorebook.'); return { ok: false }; }
        const progress = Number(s.memoryProgress?.[s.lorebook] ?? 0);
        const src = Core.selectMemorySource(data, progress, s.memoryDays, { fromDay: range?.from ?? null, toDay: range?.to ?? null });
        if (!src.days.length) { if (first) toastr.info(range ? 'There are no Days in that range.' : 'Character memories are already up to date with the log.'); return { ok: false }; }
        const label = src.days.length === 1 ? `Day ${src.days[0]}` : `Days ${src.days[0]} to ${src.days.at(-1)}`;
        note = toastr.info(`Working out who remembers what (${label}).`, 'Scene Archivist', { timeOut: 0, extendedTimeOut: 0 });
        const req = Core.buildMemoryRequest(Core.unitize(s.memoryPrompt, s.unit), src, getContext().name1 || 'the user');
        const { value: parsedMem, text } = await sideJson({ prompt: req.prompt, system: req.system, maxTokens: Number(s.maxTokens) > 0 ? Number(s.maxTokens) : 3000 }, Core.parseMemoryResponse, 'memories');
        toastr.clear(note); note = null;
        const userName = String(getContext().name1 ?? '').toLowerCase();
        const chars = parsedMem?.filter(c => !userName || ![c.name, ...c.aliases].some(n => n.toLowerCase() === userName)); // never write memories for the human's own character
        if (!chars) { toastr.error('The model did not return usable memories (it sent an empty or example reply twice). Try a stronger model for side calls, or fewer Days per batch.'); noteIssue('memories: unusable reply'); console.warn(LOG, 'memory reply', text); return { ok: false }; }
        const groups = new Map();
        for (const c of chars) { const b = memoryBookFor(c); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(c); }
        const plans = [];
        for (const [book, list] of groups) {
            const d = book === s.lorebook ? data : ((await loadWorldInfo(book)) ?? { entries: {} });
            plans.push({ book, data: d, own: s.memoryTarget === 'character' && book !== s.lorebook && book !== memoryBookName(), items: Core.planMemories(storyMemoryData(d, book), list, { cap: Number(s.memoryCap) || 30, tag: `[${s.unit || 'Day'} ${src.lastDay}]`, unit: s.unit || 'Day' }) });
        }
        const done = { ok: true, remaining: src.remaining, lastDay: src.lastDay };
        if (!plans.some(p => p.items.length)) {
            assertCurrentChat();
            beginUndoWrite();
            await saveUndoSnapshot(s.lorebook, data);
            s.memoryProgress = { ...(s.memoryProgress ?? {}), [s.lorebook]: Math.max(progress, src.lastDay) }; saveSettingsDebounced(); await updateInfoLine();
            toastr.info(`No new memories to add for ${label}.`); return done;
        }
        if (s.review && !(await showMemoryReview(plans, src))) { toastr.info('Cancelled. Nothing more was written.'); return { ok: false }; }
        assertCurrentChat();
        await commitMemories(plans, src);
        if (plans.some(p => p.items.some(i => !i.include || !i.bullets.length))) { toastr.info('Memory progress was not advanced because some results were skipped.'); return { ok: false }; }
        return done;
    } finally { if (note) try { toastr.clear(note); } catch { /* ignore */ } }
}

/** `all` keeps going batch by batch until every unprocessed Day is done. An explicit From/To range is always worked through completely. */
async function runMemories(all = false) {
    if (workbench) { try { return await workbench.startMemories(all === true); } catch (e) { console.error(LOG, e); toastr.error(e?.message ?? e); return; } }
    if (busy) { toastr.info('The archivist is already running.'); return; }
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick or create a lorebook first.'); return; }
    busy = true; operationChat = getContext().chat; operationRevision = chatRevision;
    $('.sa-mem-run').prop('disabled', true);
    try {
        const num = (v) => { const x = String(v ?? '').trim(); return x === '' ? null : Number(x); };
        const from = num($('#sa_mem_from').val() ?? s.memoryFrom), to = num($('#sa_mem_to').val() ?? s.memoryTo);
        const hasRange = from != null || to != null;
        let range = hasRange ? { from: from ?? 1, to: to ?? Infinity } : null;
        for (let n = 0; n < 200; n++) {
            const r = await memoryStep(range, n === 0);
            if (!r.ok) break;
            if (!(all === true || hasRange) || !r.remaining) break;
            range = { from: r.lastDay + 1, to: range?.to ?? Infinity };
        }
    } catch (e) {
        console.error(LOG, e);
        noteIssue('memories failed: ' + (e?.message ?? e));
        toastr.error('Character memories failed: ' + (e?.message ?? e));
    } finally {
        busy = false; operationChat = null;
        $('.sa-mem-run').prop('disabled', false);
    }
}

// ---------------------------------------------------------------- trackers, ask the archive, recap

let trId = null;
const curTracker = () => settings().trackers.find(t => t.id === trId);

function renderTrackers() {
    const s = settings();
    if (!s.trackers.length) s.trackers = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.trackers));
    if (!s.trackers.some(t => t.id === trId)) trId = s.trackers[0].id;
    $('#sa_tr_sel').html(s.trackers.map(t => `<option value="${esc(t.id)}">${t.enabled ? '✅ ' : ''}${esc(t.name)}</option>`).join('')).val(trId);
    const t = curTracker();
    $('#sa_tr_on').prop('checked', !!t.enabled); $('#sa_tr_name').val(t.name); $('#sa_tr_prompt').val(t.prompt);
    const builtin = TRACKER_TEMPLATES.some(x => x.id === t.id);
    $('#sa_tr_reset').prop('disabled', !builtin); $('#sa_tr_del').prop('disabled', builtin);
}

async function showTrackerReview(results) {
    const root = document.createElement('div');
    root.className = 'sa-review';
    root.innerHTML = `<h3>Tracker updates</h3><div class="sa-note">Edit anything. Untick a tracker to leave it as it is.</div>`;
    const refs = [];
    for (const r of results) {
        const d = document.createElement('details'); d.open = true;
        d.innerHTML = `<summary><input type="checkbox" checked><b>${esc(r.name)}</b><span class="sa-badge">${r.previous ? 'replaces the old version' : 'new entry'}</span></summary><textarea class="text_pole" rows="8"></textarea>`;
        d.querySelector('textarea').value = r.text;
        root.append(d); refs.push({ r, d });
    }
    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: 'Write trackers', cancelButton: 'Cancel', wide: true, large: true, allowVerticalScrolling: true });
    if ((await popup.show()) !== POPUP_RESULT.AFFIRMATIVE) return false;
    for (const { r, d } of refs) { r.include = d.querySelector('input[type=checkbox]').checked; r.text = d.querySelector('textarea').value; }
    return true;
}

/** Rewrite the enabled trackers (or just one) from the newest log entries. */
async function runTrackers(onlyId = null, quiet = false) {
    if (workbench) { try { return await workbench.startTrackers(onlyId, quiet); } catch (e) { if (!quiet) toastr.error(e?.message ?? e); console.warn(LOG, e); return false; } }
    const s = settings();
    if (!s.lorebook) { if (!quiet) toastr.warning('Pick or create a lorebook first.'); return false; }
    const list = s.trackers.filter(t => onlyId ? t.id === onlyId : t.enabled);
    if (!list.length) { if (!quiet) toastr.info('Switch on at least one tracker first.'); return false; }
    if (busy) { if (!quiet) toastr.info('The archivist is already running.'); return false; }
    busy = true; operationChat = getContext().chat; operationRevision = chatRevision;
    let note = null;
    try {
        const data = await loadWorldInfo(s.lorebook);
        if (!data) { toastr.error('Could not load the lorebook.'); return false; }
        const trackerBase = Memory.bookHash(data), trackerBefore = clone(data);
        const src = Core.latestUnits(data, Number(s.trackerDays) || 3);
        if (!src.days.length) { if (!quiet) toastr.info('The log has no entries to read yet.'); return false; }
        note = toastr.info(`Updating ${list.length} ${list.length === 1 ? 'tracker' : 'trackers'}.`, 'Scene Archivist', { timeOut: 0, extendedTimeOut: 0 });
        const userName = getContext().name1 || 'the user';
        const results = [];
        for (const t of list) {
            const prev = Core.trackerText(data, t.name);
            const req = Core.buildTrackerRequest({ ...t, prompt: Core.unitize(t.prompt, s.unit) }, src, prev, userName);
            const text = Core.cleanTrackerText(await sideCall({ prompt: req.prompt, system: req.system, maxTokens: 1800 }));
            if (text) results.push({ id: t.id, name: t.name, text, previous: prev, include: true });
            else noteIssue(`tracker "${t.name}": empty reply`);
        }
        toastr.clear(note); note = null;
        if (!results.length) { toastr.warning('The model returned nothing for the trackers.'); return false; }
        if (s.review && !(await showTrackerReview(results))) { toastr.info('Cancelled. Nothing was written.'); return false; }
        const picked = results.filter(r => r.include && r.text.trim());
        if (!picked.length) return false;
        if (Memory.bookHash(await loadWorldInfo(s.lorebook)) !== trackerBase) throw new Error('The archive changed while the tracker update was being reviewed. Run the tracker again with the current sources.');
        beginUndoWrite();
        await saveUndoSnapshot(s.lorebook, data);
        for (const r of picked) Core.applyTracker(data, r.name, r.text, coreOpts(), (dd) => createWorldInfoEntry(s.lorebook, dd));
        const dependencies = (workbench?.entries || []).filter(e => Memory.record(e)?.type === 'unit' && src.days.includes(Memory.record(e).unit?.number)).map(e => Memory.record(e).id);
        Memory.captureChanges(data, trackerBefore, Core.classifyEntry, { storyId: workbench?.state().storyId || '', reason: 'Tracker update' }, dependencies);
        for (const e of Object.values(data.entries)) if (Core.classifyEntry(e)?.type === 'tracker' && Memory.record(e)) {
            e.sceneArchivistArchive = s.lorebook;
            Memory.record(e).derivedHashes = Object.fromEntries(dependencies.map(id => [id, Memory.hash(workbench.find(id)?.content || '')]));
        }
        await saveWorldInfo(s.lorebook, data, true);
        try { reloadEditor(s.lorebook); } catch { /* editor closed */ }
        s.lastWriteBooks = [s.lorebook]; saveSettingsDebounced();
        await updateInfoLine();
        toastr.success(`Updated ${picked.length} ${picked.length === 1 ? 'tracker' : 'trackers'}.`);
        return true;
    } catch (e) {
        console.error(LOG, e); noteIssue('trackers failed: ' + (e?.message ?? e));
        toastr.error('Trackers failed: ' + (e?.message ?? e));
        return false;
    } finally {
        if (note) try { toastr.clear(note); } catch { /* ignore */ }
        busy = false; operationChat = null;
    }
}

let asking = false;
const answerPopup = (title, text) => callGenericPopup(`<div style="text-align:left"><h3>${esc(title)}</h3><div style="white-space:pre-wrap">${esc(text)}</div></div>`, POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });

async function askArchive(question) {
    if (workbench) { try { return await workbench.ask(question); } catch (e) { toastr.error(e?.message ?? e); return; } }
    const s = settings();
    const q = String(question ?? '').trim();
    if (!q) { toastr.info('Type a question first.'); return; }
    if (!s.lorebook) { toastr.warning('Pick or create a lorebook first.'); return; }
    if (asking) return;
    asking = true;
    const note = toastr.info('Reading the archive.', 'Scene Archivist', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const data = await loadWorldInfo(s.lorebook);
        if (!data) { toastr.error('Could not load the lorebook.'); return; }
        const req = Core.buildAskRequest(s.askPrompt, q, data, { maxChars: 60000 });
        const text = await sideCall({ prompt: req.prompt, system: req.system, maxTokens: 700 });
        toastr.clear(note);
        await answerPopup(q, (text || '(no answer)').trim() + (req.omitted ? `\n\n(${req.omitted} older ${req.omitted === 1 ? 'entry was' : 'entries were'} left out to fit.)` : ''));
    } catch (e) { console.error(LOG, e); toastr.error('Ask failed: ' + (e?.message ?? e)); }
    finally { try { toastr.clear(note); } catch { /* ignore */ } asking = false; }
}

async function recap() {
    if (workbench) { try { return await workbench.recap(); } catch (e) { toastr.error(e?.message ?? e); return; } }
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick or create a lorebook first.'); return; }
    if (asking) return;
    asking = true;
    const note = toastr.info('Writing the recap.', 'Scene Archivist', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const data = await loadWorldInfo(s.lorebook);
        const req = data ? Core.buildRecapRequest(s.recapPrompt, data, 3) : null;
        if (!req || !req.days.length) { toastr.info('The log has no entries to recap yet.'); return; }
        const text = await sideCall({ prompt: req.prompt, system: req.system, maxTokens: 600 });
        toastr.clear(note);
        await answerPopup('Previously on...', (text || '(no recap)').trim());
    } catch (e) { console.error(LOG, e); toastr.error('Recap failed: ' + (e?.message ?? e)); }
    finally { try { toastr.clear(note); } catch { /* ignore */ } asking = false; }
}

// ---------------------------------------------------------------- Recall

function recentMessages(n, dropTrailingAi, pending = '') {
    let msgs = (getContext().chat ?? []).filter(m => !m.is_system && String(m.mes ?? '').trim());
    if (dropTrailingAi && msgs.length && !msgs.at(-1).is_user) msgs = msgs.slice(0, -1);
    const list = msgs.map(m => ({ name: m.name, mes: String(m.mes) }));
    // SillyTavern adds the user's new message to the chat only AFTER generation starts, so it is still in the text box here.
    if (String(pending).trim()) list.push({ name: getContext().name1 || 'User', mes: String(pending) });
    return list.slice(-Math.max(1, n)).map(m => `${m.name}: ${m.mes.replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n');
}

async function runRecall(type, pending = '') {
    const s = settings();
    const data = await loadWorldInfo(s.lorebook);
    if (!data) return null;
    const recent = recentMessages(Number(s.recallMessages) || 4, ['swipe', 'regenerate'].includes(type), pending);
    const index = Core.buildRecallIndex(data, { limit: 120, recentText: recent });
    if (!index.length || !recent) return { picked: [], index };
    const max = Math.max(1, Number(s.recallMax) || 4);
    const rp = Core.buildRecallPrompt(index, recent, max);
    const { value: ids, text } = await sideJson({ prompt: rp.prompt, system: rp.system, maxTokens: 300 }, t => Core.parseRecallResponse(t, index, max), 'recall');
    if (ids === null) { console.warn(LOG, 'recall reply was not usable', text); return { picked: [], index, bad: true }; }
    return { picked: index.filter(x => ids.includes(x.id)), index };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

function showRecallResult(r, prefix) {
    const msg = r?.bad ? 'The model gave an unusable answer, so only keywords were used.'
        : r?.picked?.length ? `${prefix}${r.picked.map(p => p.title).join(' | ')}` : `${prefix}nothing extra`;
    $('#sa_recall_last').text(msg);
}

async function forceActivate(name, uids) {
    if (!uids.length) return;
    const data = await loadWorldInfo(name);
    // ST adds the object it is given straight into the prompt, so it must be a full entry, not just { world, uid }.
    const full = uids.map(u => data?.entries?.[u]).filter(Boolean).map(e => ({ ...e, world: name, decorators: e.decorators ?? [] }));
    if (full.length) await eventSource.emit(event_types.WORLDINFO_FORCE_ACTIVATE, full);
}

async function onGenerationStarted(type, params, dryRun) {
    if (workbench) { try { await workbench.beforeGeneration(type, params, dryRun); } catch (e) { console.warn(LOG, e); } return; }
    const s = settings();
    if (!s.recall || dryRun || busy || recallBusy || !s.lorebook) return;
    if (params?.quiet_prompt || type === 'quiet') return;
    if (!isLorebookActive(s.lorebook)) return;
    const startingChat = getContext().chat, archive = s.lorebook, startingRevision = chatRevision;
    recallBusy = true;
    try {
        const hold = 3; // recalled entries stay for a few messages so the prompt does not flip every turn
        for (const [u, n] of [...held]) { if (n <= 1) held.delete(u); else held.set(u, n - 1); }
        try {
            const sendsText = !params?.automatic_trigger && !['swipe', 'regenerate', 'continue', 'impersonate', 'quiet'].includes(type);
            const pending = sendsText ? String($('#send_textarea').val() ?? '') : '';
            const r = await withTimeout(runRecall(type, pending), 30000);
            if (getContext().chat !== startingChat || chatRevision !== startingRevision || s.lorebook !== archive) return;
            showRecallResult(r, 'Last recall: ');
            for (const p of r?.picked ?? []) held.set(p.uid, hold);
        } catch (e) {
            console.warn(LOG, 'recall failed, keywords only', e);
            $('#sa_recall_last').text('Recall failed (' + (e?.message ?? e) + '), so only keywords were used.');
        }
        const cap = Math.max(1, Number(s.recallMax) || 4) + 2;
        while (held.size > cap) held.delete(held.keys().next().value);
        if (getContext().chat === startingChat && chatRevision === startingRevision && s.lorebook === archive) await forceActivate(archive, [...held.keys()]);
    } catch (e) {
        console.warn(LOG, 'recall step failed', e);
    } finally { recallBusy = false; }
}

async function testRecall() {
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick a lorebook first.'); return; }
    if (!(getContext().chat?.length)) { toastr.warning('Open a chat first.'); return; }
    if (recallBusy) return;
    recallBusy = true;
    try {
        const r = await withTimeout(runRecall('test'), 60000);
        showRecallResult(r, 'Would load: ');
        toastr.info(r?.picked?.length ? 'Would load: ' + r.picked.map(p => p.title).join(', ') : (r?.bad ? 'Unusable answer from the model.' : 'Nothing extra needed.'), 'Recall test');
    } catch (e) { toastr.error('Recall test failed: ' + (e?.message ?? e)); } finally { recallBusy = false; }
}

// ---------------------------------------------------------------- reminder

let lastRemindAt = 0;
async function onMessageReceived() {
    try {
        const s = settings();
        const every = Number(s.remindEvery) || 0;
        if (!every || busy) return;
        const len = getContext().chat?.length ?? 0;
        const since = len - (chat_metadata?.[KEY]?.messages ?? 0);
        if (since < every || len - lastRemindAt < every) return;
        lastRemindAt = len;
        if (s.autoArchive) { await runSummarize(); return; }
        toastr.info(`${since} messages since the last archive. Click here to archive now.`, 'Scene Archivist', { timeOut: 20000, onclick: () => runSummarize() });
    } catch (e) { console.warn(LOG, e); }
    finally { if (workbench) await workbench.afterReply().catch(e => console.warn(LOG, e)); }
}

// ---------------------------------------------------------------- UI

function panelHtml() {
    return `
<div class="sa-panel">
    <div class="sa-title">🗂️ Scene Archivist <span class="sa-ver">v${VERSION}</span></div>
    <div class="sa-hero">
      <div class="sa-row"><select id="sa_lorebook" class="text_pole" title="The lorebook that holds your Scene Log"></select></div>
      <div class="sa-row"><input id="sa_newname" class="text_pole" type="text" placeholder="New lorebook name"><input id="sa_create" class="menu_button" type="button" value="Create"></div>
      <div class="sa-hint" id="sa_info"></div>
      <div class="sa-row sa-main"><input id="sa_run" class="menu_button sa-run" type="button" value="✨ Archive now" title="A quickie: summarize what is new and file it in the lorebook"><input id="sa_thorough" class="menu_button sa-run sa-run2" type="button" value="💋 Archive thoroughly" title="Takes its time and covers everything: the log, the character memories and a tidy-up"><input id="sa_paste" class="menu_button" type="button" value="📋 Paste" title="Paste an archivist reply you wrote or got elsewhere"></div>
      <div class="sa-status" id="sa_status"></div>
      <div class="sa-row sa-mini"><input id="sa_check" class="menu_button" type="button" value="Check setup"><input id="sa_attach" class="menu_button" type="button" value="Attach to chat"><input id="sa_fix" class="menu_button" type="button" value="Fix delivery"><input id="sa_undo" class="menu_button" type="button" value="↩ Undo" title="Undo the last archive write"><input id="sa_diag" class="menu_button" type="button" value="Diagnostics" title="Copy a short report for bug reports"></div>
    </div>

    <details class="sa-card" open><summary>📒 Ledger</summary><div class="sa-body">
      <div class="sa-hint" id="sa_ledger_sum"></div>
      <div id="sa_ledger"></div>
      <div class="sa-row"><label for="sa_range_from">Only messages</label><input id="sa_range_from" class="text_pole" type="number" min="0" placeholder="from"><input id="sa_range_to" class="text_pole" type="number" min="0" placeholder="to"></div>
      <div class="sa-row"><label for="sa_archmode">Archive using</label><select id="sa_archmode" class="text_pole" title="Transcript only works with any preset. The chat mode uses your preset and card."><option value="isolated">The transcript, in passes</option><option value="chat">The chat, as the model sees it</option></select></div>
      <div class="sa-row"><label for="sa_chunk">Tokens per pass</label><input id="sa_chunk" class="text_pole" type="number" min="2000" max="200000"></div>
      <label class="checkbox_label"><input id="sa_hide" type="checkbox"><span>Hide messages once archived</span></label>
      <div class="sa-row"><label for="sa_keepvis">Keep visible</label><input id="sa_keepvis" class="text_pole" type="number" min="0" max="200" title="How many of the newest messages stay visible"></div>
      <div class="sa-row"><input id="sa_through" class="text_pole" type="number" min="0" placeholder="message #"><input id="sa_through_set" class="menu_button" type="button" value="Mark archived through"><input id="sa_ledger_import" class="menu_button" type="button" value="Import list"></div>
    </div></details>

    <details class="sa-card"><summary>🧠 Memory settings and prompt</summary><div class="sa-body">
      <div class="sa-row"><input id="sa_mem_run" class="menu_button sa-mem-run" type="button" value="Next batch" title="Process the next few Days, oldest first"><input id="sa_mem_all" class="menu_button sa-mem-run" type="button" value="All remaining Days"></div>
      <div class="sa-row"><label for="sa_mem_from">Only Days</label><input id="sa_mem_from" class="text_pole" type="number" min="0" placeholder="from"><input id="sa_mem_to" class="text_pole" type="number" min="0" placeholder="to" title="Fill both to redo a range, for example 1 to 17. Empty continues where the last run stopped."></div>
      <div class="sa-row"><label for="sa_mem_target">Save in</label><select id="sa_mem_target" class="text_pole"><option value="separate">A separate memories lorebook</option><option value="archive">The archive lorebook</option><option value="character">Each character's own lorebook</option></select></div>
      <div class="sa-row"><label for="sa_mem_book">Lorebook name</label><input id="sa_mem_book" class="text_pole" type="text" placeholder="(archive name) Memories"></div>
      <div class="sa-row"><label for="sa_mem_days">Days per batch</label><input id="sa_mem_days" class="text_pole" type="number" min="1" max="20"></div>
      <div class="sa-row"><label for="sa_mem_cap">Warn above</label><input id="sa_mem_cap" class="text_pole" type="number" min="5" max="200" title="Memories per character"></div>
      <label class="checkbox_label"><input id="sa_mem_auto" type="checkbox"><span>Run after every archive write</span></label>
      <div class="sa-sub">Memory prompt</div>
      <textarea id="sa_mem_prompt" class="text_pole" rows="8"></textarea>
      <div class="sa-row"><input id="sa_mem_prompt_reset" class="menu_button" type="button" value="Reset prompt"></div>
    </div></details>

    <details class="sa-card"><summary>🧬 Condense character memories</summary><div class="sa-body">
      <div class="sa-hint">For each character's memory list: merges repeated memories and keeps every date. Archive entries are condensed in the card above.</div>
      <div class="sa-row"><label for="sa_cond_above">Lists longer than</label><input id="sa_cond_above" class="text_pole" type="number" min="2" max="200"></div>
      <div class="sa-row"><input id="sa_cond_run" class="menu_button sa-cond-run" type="button" value="Condense memories" title="Merges duplicates. You review every change and Undo brings the old lists back."></div>
      <div class="sa-sub">Condense prompt</div>
      <textarea id="sa_cond_prompt" class="text_pole" rows="6"></textarea>
      <div class="sa-row"><input id="sa_cond_prompt_reset" class="menu_button" type="button" value="Reset prompt"></div>
    </div></details>

    <details class="sa-card"><summary>📌 Trackers</summary><div class="sa-body">
      <div class="sa-hint">Extra always-on notes, rewritten after each archive.</div>
      <div class="sa-row"><select id="sa_tr_sel" class="text_pole"></select></div>
      <label class="checkbox_label"><input id="sa_tr_on" type="checkbox"><span>Keep this one updated</span></label>
      <div class="sa-row"><label for="sa_tr_name">Name</label><input id="sa_tr_name" class="text_pole" type="text" maxlength="60"></div>
      <textarea id="sa_tr_prompt" class="text_pole" rows="5"></textarea>
      <div class="sa-row"><input id="sa_tr_run" class="menu_button" type="button" value="Update this one"><input id="sa_tr_all" class="menu_button" type="button" value="Update all enabled"></div>
      <div class="sa-row"><input id="sa_tr_new" class="menu_button" type="button" value="New"><input id="sa_tr_del" class="menu_button" type="button" value="Delete"><input id="sa_tr_reset" class="menu_button" type="button" value="Reset"></div>
      <label class="checkbox_label"><input id="sa_tr_auto" type="checkbox"><span>Update after every archive write</span></label>
      <div class="sa-row"><label for="sa_tr_days">Entries to read</label><input id="sa_tr_days" class="text_pole" type="number" min="1" max="20" title="How many of the newest log entries each update reads"></div>
    </div></details>

    <details class="sa-card"><summary>🔎 Ask and recap</summary><div class="sa-body">
      <div class="sa-row"><input id="sa_ask_q" class="text_pole" type="text" placeholder="Ask the archive, e.g. who knows about the ring?"><input id="sa_ask_go" class="menu_button" type="button" value="Ask"></div>
      <div class="sa-row"><input id="sa_recap" class="menu_button" type="button" value="📺 Previously on..." title="A short recap of the newest entries, for when you come back to a story"></div>
    </div></details>

    <details class="sa-card"><summary>🔮 Recall</summary><div class="sa-body">
      <label class="checkbox_label"><input id="sa_recall" type="checkbox"><span>Let the model pick keyed entries before each reply</span></label>
      <div class="sa-hint">One extra small request. Keywords still work as usual.</div>
      <div class="sa-row"><label for="sa_recall_msgs">Messages to read</label><input id="sa_recall_msgs" class="text_pole" type="number" min="1" max="20"></div>
      <div class="sa-row"><label for="sa_recall_max">Max entries</label><input id="sa_recall_max" class="text_pole" type="number" min="1" max="10"></div>
      <div class="sa-row"><input id="sa_recall_test" class="menu_button" type="button" value="Test recall"></div>
      <div class="sa-hint" id="sa_recall_last"></div>
    </div></details>

    <details class="sa-card"><summary>👀 What the model saw</summary><div class="sa-body">
      <div class="sa-hint" id="sa_view_sum">Nothing yet. Send a message first.</div>
      <div id="sa_view_list"></div>
    </div></details>

    <details class="sa-card"><summary>📍 Delivery</summary><div class="sa-body">
      <div class="sa-row"><label for="sa_delivery">Where the log goes</label><select id="sa_delivery" class="text_pole">
        <option value="depth">In the chat, at a depth</option>
        <option value="before">Before character definitions</option>
        <option value="after">After character definitions</option>
        <option value="outlet">Outlet (needs {{outlet::name}} in your preset)</option>
      </select></div>
      <div class="sa-row sa-d-depth"><label for="sa_depth">Depth</label><input id="sa_depth" class="text_pole" type="number" min="0" max="100"></div>
      <div class="sa-row sa-d-depth"><label for="sa_role">Role</label><select id="sa_role" class="text_pole"><option value="0">System</option><option value="1">User</option><option value="2">Assistant</option></select></div>
      <div class="sa-row sa-d-outlet"><label for="sa_outlet">Outlet name</label><input id="sa_outlet" class="text_pole" type="text"></div>
      <div class="sa-row"><label for="sa_keepdays">Days always on</label><input id="sa_keepdays" class="text_pole" type="number" min="0" max="20"></div>
      <div class="sa-row"><label for="sa_scan">Scan depth</label><input id="sa_scan" class="text_pole" type="number" min="1" max="50"></div>
    </div></details>

    <details class="sa-card"><summary>✍️ Prompts</summary><div class="sa-body">
      <div class="sa-row"><select id="sa_pl_sel" class="text_pole"></select></div>
      <div class="sa-row"><label for="sa_pl_name">Name</label><input id="sa_pl_name" class="text_pole" type="text" maxlength="60"></div>
      <div class="sa-row"><label for="sa_unit">Unit word</label><select id="sa_unit" class="text_pole" title="What your log calls its units. Headings and memories use it.">${Core.UNITS.map(u => `<option value="${u}">${u}</option>`).join('')}<option value="__custom">Custom unit...</option></select><input id="sa_custom_unit" class="text_pole" maxlength="32" placeholder="Custom singular unit, for example Volume" aria-label="Custom singular story unit"></div>
      <textarea id="sa_prompt" class="text_pole" rows="10"></textarea>
      <div class="sa-row"><input id="sa_pl_new" class="menu_button" type="button" value="New"><input id="sa_pl_dup" class="menu_button" type="button" value="Duplicate"><input id="sa_pl_del" class="menu_button" type="button" value="Delete"><input id="sa_pl_reset" class="menu_button" type="button" value="Reset to built-in"></div>
      <div class="sa-row"><input id="sa_pl_export" class="menu_button" type="button" value="Export"><input id="sa_pl_import" class="menu_button" type="button" value="Import"><input id="sa_pl_file" type="file" accept=".json,application/json" style="display:none"><input id="sa_log_md" class="menu_button" type="button" value="Log as markdown"></div>
      <div class="sa-sub">Legend (for new lorebooks)</div>
      <textarea id="sa_legend" class="text_pole" rows="5"></textarea>
      <div class="sa-sub">Opening line (for new lorebooks)</div>
      <textarea id="sa_opening" class="text_pole" rows="3"></textarea>
    </div></details>

    <details class="sa-card"><summary>⚙️ More</summary><div class="sa-body">
      <div class="sa-row"><label for="sa_side_profile">Small requests on</label><select id="sa_side_profile" class="text_pole" title="Keywords, Recall, memories and Condense can use a cheaper Connection Manager profile"></select><input id="sa_side_test" class="menu_button" type="button" value="Test"></div>
      <div class="sa-row"><label for="sa_keymode">Keywords</label><select id="sa_keymode" class="text_pole"><option value="ai">Ask the model</option><option value="heuristic">Automatic only</option></select></div>
      <div class="sa-row"><label for="sa_maxtok">Max reply tokens</label><input id="sa_maxtok" class="text_pole" type="number" min="0" max="64000" title="0 uses your preset's response length"></div>
      <div class="sa-row"><label for="sa_remind">Remind me every</label><input id="sa_remind" class="text_pole" type="number" min="0" max="500" title="Messages, 0 = never"></div>
      <label class="checkbox_label"><input id="sa_autoarch" type="checkbox"><span>Archive automatically instead of reminding</span></label>
      <label class="checkbox_label"><input id="sa_review" type="checkbox"><span>Review before writing</span></label>
      <label class="checkbox_label"><input id="sa_append" type="checkbox"><span>Append the log to my prompt (chat mode, no outlet)</span></label>
      <div class="sa-sub">Never use as keywords</div>
      <textarea id="sa_avoid" class="text_pole" rows="2" placeholder="Names in every scene, comma separated"></textarea>
    </div></details>
</div>`;
}

/** Only used when the test flag is set: the same panel inside the Extensions drawer. */
function settingsHtml() {
    return `<div class="inline-drawer" id="sa_drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🗂️ Scene Archivist</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">${panelHtml()}</div></div>`;
}

/** The whole panel in a popup, opened from the wand menu. The same elements are moved in and back, so nothing is duplicated. */
async function openPanelPopup() {
    const panel = document.querySelector('.sa-panel');
    if (!panel || panel.dataset.popped) return;
    const home = panel.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'sa-popwrap';
    panel.dataset.popped = '1';
    wrap.append(panel);
    try {
        const popup = new Popup(wrap, POPUP_TYPE.TEXT, '', { okButton: 'Close', cancelButton: false, wide: true, large: true, allowVerticalScrolling: true });
        await popup.show();
    } finally { home.append(panel); delete panel.dataset.popped; }
}

function bindUi() {
    const s = settings();
    const bindVal = (id, key, num = false) => {
        $(id).val(s[key]).on('input change', function () { if (busy) { $(this).val(s[key]); return; } s[key] = num ? Number($(this).val()) : $(this).val(); saveSettingsDebounced(); });
    };
    bindVal('#sa_outlet', 'outlet'); bindVal('#sa_delivery', 'delivery'); bindVal('#sa_depth', 'depth', true); bindVal('#sa_role', 'role', true);
    const showDelivery = () => { const m = $('#sa_delivery').val(); $('.sa-d-depth').toggle(m === 'depth'); $('.sa-d-outlet').toggle(m === 'outlet'); };
    $('#sa_delivery').on('change', showDelivery); showDelivery(); bindVal('#sa_keepdays', 'keepDays', true);
    bindVal('#sa_scan', 'scanDepth', true); bindVal('#sa_keymode', 'keyMode'); bindVal('#sa_maxtok', 'maxTokens', true);
    bindVal('#sa_avoid', 'avoid'); bindVal('#sa_legend', 'legend');
    renderPromptLib();
    $('#sa_prompt').on('input change', function () { savePromptText($(this).val()); });
    $('#sa_pl_sel').on('change', promptSelect); $('#sa_pl_name').on('input change', promptRename);
    $('#sa_pl_new').on('click', promptNew); $('#sa_pl_dup').on('click', promptDuplicate); $('#sa_pl_del').on('click', promptDelete); $('#sa_pl_reset').on('click', promptReset);
    $('#sa_pl_export').on('click', promptExport); $('#sa_pl_import').on('click', () => $('#sa_pl_file').trigger('click'));
    $('#sa_pl_file').on('change', function () { if (this.files[0]) promptImportFile(this.files[0]); this.value = ''; });
    $('#sa_log_md').on('click', exportLogMd);
 bindVal('#sa_opening', 'opening');
    $('#sa_review').prop('checked', s.review).on('change', function () { s.review = this.checked; saveSettingsDebounced(); });
    $('#sa_append').prop('checked', s.appendLog).on('change', function () { s.appendLog = this.checked; saveSettingsDebounced(); });
    $('#sa_lorebook').on('change', async function () { if (busy) { $(this).val(s.lorebook); return; } s.lorebook = $(this).val(); s.memoryBook = ''; await refreshChatUi(); });
    $('#sa_create').on('click', createLorebook);
    $('#sa_run').on('click', () => runSummarize());
    $('#sa_thorough').on('click', () => runSummarize({ thorough: true }));
    const saveUnit = value => {
        const previous = s.unit;
        s.unit = Memory.cleanUnit(value); Core.registerUnits([s.unit]);
        const cur = promptItems().find(p => p.id === s.promptId), at = s.promptLibrary.findIndex(p => p.id === s.promptId);
        if (at >= 0) s.promptLibrary[at].unit = s.unit;
        else s.promptLibrary.push({ id: s.promptId, name: cur.name, text: cur.text, unit: s.unit });
        if (s.unit !== previous) { const text = String($('#sa_prompt').val() || s.prompt); savePromptText(Core.changeUnit(text, previous, s.unit)); }
        saveSettingsDebounced(); renderPromptLib(); workbench?.updateUnitLabels();
    };
    $('#sa_unit').on('change', function () { const unit = String($(this).val()); if (unit !== '__custom') saveUnit(unit); else $('#sa_custom_unit').trigger('focus'); });
    $('#sa_custom_unit').on('change', function () { if (String(this.value).trim()) saveUnit(this.value); });
    $('#sa_paste').on('click', pasteOutput);
    $('#sa_check').on('click', checkSetup);
    $('#sa_attach').on('click', attachToChat);
    $('#sa_fix').on('click', fixOutlet);
    $('#sa_undo').on('click', undoLast);
    $('#sa_recall').prop('checked', s.recall).on('change', function () { s.recall = this.checked; saveSettingsDebounced(); });
    bindVal('#sa_recall_msgs', 'recallMessages', true); bindVal('#sa_recall_max', 'recallMax', true);
    $('#sa_recall_test').on('click', testRecall);
    bindVal('#sa_remind', 'remindEvery', true);
    $('#sa_diag').on('click', copyDiagnostics);
    renderTrackers();
    $('#sa_tr_sel').on('change', function () { trId = String($(this).val()); renderTrackers(); });
    $('#sa_tr_on').on('change', function () { curTracker().enabled = this.checked; saveSettingsDebounced(); renderTrackers(); });
    $('#sa_tr_name').on('change', function () { curTracker().name = String($(this).val()).trim().slice(0, 60) || 'My tracker'; saveSettingsDebounced(); renderTrackers(); });
    $('#sa_tr_prompt').on('input change', function () { curTracker().prompt = String($(this).val()); saveSettingsDebounced(); });
    $('#sa_tr_new').on('click', () => { const id = 't-' + Date.now().toString(36); s.trackers.push({ id, name: 'My tracker', enabled: false, prompt: 'Track what matters here. One short bullet per item, with the Day it last changed.' }); trId = id; saveSettingsDebounced(); renderTrackers(); });
    $('#sa_tr_del').on('click', () => { if (TRACKER_TEMPLATES.some(x => x.id === trId)) return; s.trackers = s.trackers.filter(x => x.id !== trId); saveSettingsDebounced(); renderTrackers(); });
    $('#sa_tr_reset').on('click', () => { const tpl = TRACKER_TEMPLATES.find(x => x.id === trId); if (!tpl) return; Object.assign(curTracker(), { name: tpl.name, prompt: tpl.prompt }); saveSettingsDebounced(); renderTrackers(); toastr.info('Tracker reset to the built-in version.'); });
    $('#sa_tr_run').on('click', () => runTrackers(trId)); $('#sa_tr_all').on('click', () => runTrackers());
    $('#sa_tr_auto').prop('checked', s.trackerAuto).on('change', function () { s.trackerAuto = this.checked; saveSettingsDebounced(); });
    bindVal('#sa_tr_days', 'trackerDays', true);
    $('#sa_autoarch').prop('checked', s.autoArchive).on('change', function () { s.autoArchive = this.checked; saveSettingsDebounced(); });
    $('#sa_ask_go').on('click', () => askArchive($('#sa_ask_q').val()));
    $('#sa_ask_q').on('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); askArchive($('#sa_ask_q').val()); } });
    $('#sa_recap').on('click', recap);
    bindVal('#sa_archmode', 'archiveMode'); bindVal('#sa_chunk', 'chunkTokens', true); bindVal('#sa_keepvis', 'keepVisible', true);
    $('#sa_hide').prop('checked', s.hideArchived).on('change', function () { s.hideArchived = this.checked; saveSettingsDebounced(); });
    $('#sa_through_set').on('click', setThrough); $('#sa_ledger_import').on('click', importLedger);
    $('#sa_chunk').on('change input', () => renderLedger());
    renderLedger();
    $('#sa_mem_run').on('click', () => runMemories(false));
    $('#sa_mem_all').on('click', () => runMemories(true));
    $('#sa_cond_run').on('click', () => runCondense());
    bindVal('#sa_cond_above', 'condenseAbove', true); bindVal('#sa_cond_prompt', 'condensePrompt');
    $('#sa_cond_prompt_reset').on('click', () => { s.condensePrompt = DEFAULT_SETTINGS.condensePrompt; $('#sa_cond_prompt').val(s.condensePrompt); saveSettingsDebounced(); toastr.info('Condense prompt reset to the default.'); });
    refreshProfileList();
    $('#sa_side_profile').on('change', function () { s.sideProfile = $(this).val(); saveSettingsDebounced(); });
    $('#sa_side_test').on('click', testSide);
    $('#sa_drawer .inline-drawer-toggle').on('click', refreshProfileList);
    $('#sa_mem_auto').prop('checked', s.memoryAuto).on('change', function () { s.memoryAuto = this.checked; saveSettingsDebounced(); });
    bindVal('#sa_mem_target', 'memoryTarget'); bindVal('#sa_mem_book', 'memoryBook'); bindVal('#sa_mem_from', 'memoryFrom'); bindVal('#sa_mem_to', 'memoryTo'); bindVal('#sa_mem_days', 'memoryDays', true); bindVal('#sa_mem_cap', 'memoryCap', true); bindVal('#sa_mem_prompt', 'memoryPrompt');
    $('#sa_mem_prompt_reset').on('click', () => { s.memoryPrompt = DEFAULT_SETTINGS.memoryPrompt; $('#sa_mem_prompt').val(s.memoryPrompt); saveSettingsDebounced(); toastr.info('Memory prompt reset to the default.'); });
}

jQuery(async () => {
    try {
        settings();
        let dock = false;
        try { dock = localStorage.getItem('sa_dock') === '1'; } catch { /* ignore */ }
        if (dock) $('#extensions_settings2').append(settingsHtml());
        else $('body').append(`<div id="sa_holder" style="display:none">${panelHtml()}</div>`);
        bindUi();
        workbench = new Workbench({
            settings, meta, context: () => ({ ...getContext(), chatId: getCurrentChatId(), characterId: this_chid }),
            saveMeta: saveMetadata, saveSettings: saveSettingsDebounced,
            worldNames: lorebookNames, load: loadWorldInfo, save: (name, data) => saveWorldInfo(name, data, true),
            createBook: async name => { if (!getContext().getWorldInfoNames().includes(name) && !(await createNewWorldInfo(name))) throw new Error('Could not create ' + name); await updateWorldInfoList(); },
            makeEntry: (name, data) => createWorldInfoEntry(name, data), register: registerStoryBook,
            memoryBook: memoryBookName, memoryBookFor, own: storyMemoryData, options: coreOpts,
            assert: assertCurrentChat, isBusy: () => busy, isActive: () => !!settings().lorebook && !!isLorebookActive(settings().lorebook),
            begin: () => { if (busy) return false; busy = true; operationChat = getContext().chat; operationRevision = chatRevision; $('.sa-run,.sa-mem-run,.sa-cond-run').prop('disabled', true); return true; },
            end: () => { busy = false; operationChat = null; $('.sa-run,.sa-mem-run,.sa-cond-run').prop('disabled', false); },
            undoStart: beginUndoWrite, snapshot: saveUndoSnapshot, reload: name => { try { reloadEditor(name); } catch { /* editor closed */ } },
            model: sideCall, tokenCount: getTokenCountAsync, hide: hideChatMessageRange, renderLedger, prepareArchive, refreshInfo: updateInfoLine,
            archiveModel: async (req, range) => settings().archiveMode === 'chat' && !range.explicit
                ? generateQuietPrompt({ quietPrompt: req.system + '\n\n' + req.prompt, responseLength: Number(settings().maxTokens) > 0 ? Number(settings().maxTokens) : null })
                : generateRaw({ prompt: req.prompt, systemPrompt: req.system, responseLength: Number(settings().maxTokens) > 0 ? Number(settings().maxTokens) : 6000 }),
            acceptArchive: async (text, source, step) => { archiveSource = source; archiveStep = step; try { return await handleOutput(text); } finally { archiveSource = null; archiveStep = ''; } },
            afterArchive,
            ensureArchive: ensureLorebook,
            attach: async name => { chat_metadata[METADATA_KEY] = name; await saveMetadata(); $('.chat_lorebook_button').addClass('world_set'); },
            trackers: () => runTrackers(null, true),
            confirm: async (root, opts = {}) => (await new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: 'Apply', cancelButton: 'Cancel', wide: true, large: true, allowVerticalScrolling: true, ...opts }).show()) === POPUP_RESULT.AFFIRMATIVE,
            confirmText: async text => { const result = await callGenericPopup(esc(text), POPUP_TYPE.CONFIRM); return result === true || result === POPUP_RESULT.AFFIRMATIVE; },
            show: root => new Popup(root, POPUP_TYPE.TEXT, '', { okButton: 'Close', cancelButton: false, wide: true, large: true, allowVerticalScrolling: true }).show(),
            notify: (message, kind = 'info') => toastr[kind](message, 'Scene Archivist'),
            offerRecap: callback => toastr.info('Welcome back. Click for a dated recap of this story.', 'Scene Archivist', { timeOut: 20000, onclick: callback }),
            download: downloadFile, rebindSettings: () => { renderPromptLib(); renderTrackers(); void refreshLorebookList(); },
            vectorSettings: () => extension_settings.vectors, vectorHash: getStringHash, requestHeaders: getRequestHeaders,
        });
        workbench.mount(document.querySelector('.sa-panel'));
        migrateStoryBooks();
        await refreshChatUi();
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'archivist',
            callback: async () => { await runSummarize(); return ''; },
            helpString: 'Run the Scene Archivist: summarize with your archivist prompt and file the result into the selected lorebook.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'archivist-condense',
            callback: async () => { await runCondense(); return ''; },
            helpString: 'Condense long character memory lists (with review).',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'archivist-memories',
            callback: async () => { await runMemories(true); return ''; },
            helpString: 'Create character memories from the newest Days of the Scene Log.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'archivist-recap',
            callback: async () => { await recap(); return ''; },
            helpString: 'Show a short "previously on" recap of the newest entries in the Scene Log.',
        }));
        eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
        eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
        eventSource.on(event_types.WORLDINFO_FORCE_ACTIVATE, entries => workbench.onVectorActivated(entries));
        $('#extensionsMenu').append(`<div id="sa_wand" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-book-journal-whills extensionsMenuExtensionButton"></div><span>Archive scene</span></div>`);
        $('#sa_wand').on('click', () => runSummarize());
        $('#extensionsMenu').append(`<div id="sa_wand_panel" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-folder-tree extensionsMenuExtensionButton"></div><span>Scene Archivist</span></div>`);
        $('#sa_wand_panel').on('click', openPanelPopup);
        eventSource.on(event_types.CHAT_CHANGED, () => { chatRevision++; return refreshChatUi(); });
        for (const event of [event_types.MESSAGE_EDITED, event_types.MESSAGE_DELETED, event_types.MESSAGE_SWIPED].filter(Boolean)) eventSource.on(event, () => { if (!busy) void workbench.refresh().catch(e => console.warn(LOG, e)); });
        console.log(LOG, 'loaded');
    } catch (e) {
        console.error(LOG, 'failed to load', e);
    }
});

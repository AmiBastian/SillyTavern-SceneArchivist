// Scene Archivist: runs your archivist prompt and files the result into a lorebook.
// The log lives in lorebook entries delivered through a World Info outlet ({{outlet::scene_log}} in your preset).

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, generateQuietPrompt, generateRaw, chat_metadata, saveMetadata, main_api, characters, this_chid, eventSource, event_types, getCurrentChatId, getRequestHeaders, getMaxContextTokens, getMaxResponseTokens, showMoreMessages, Generate } from '../../../../script.js';
import { callGenericPopup, Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { getCharaFilename, getStringHash, getSanitizedFilename } from '../../../utils.js';
import { hideChatMessageRange } from '../../../chats.js';
import { selected_world_info, METADATA_KEY, createWorldInfoEntry, worldInfoCache, updateWorldInfoList, reloadEditor, world_info, world_info_budget, world_info_budget_cap, world_info_recursive, world_info_max_recursion_steps } from '../../../world-info.js';
import { oai_settings } from '../../../openai.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { power_user } from '../../../power-user.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import * as Core from './core.js';
import { archiveAnswer, uncoveredArchiveMessages } from './flow.js';
import * as Memory from './memory-engine.js';
import { Workbench } from './workbench.js';
import { ChatControls } from './chat-controls.js';
import { addReviewHandle } from './review-window.js';
import { VERSION } from './version.js';
import { entryReasons } from './vector-diagnostics.js';
import { createWorldInfoIO } from './world-info-io.js';
import * as Journal from './entry-journal.js';
import { validateSharedUnits, placeSharedUnits } from './workflow-tools.js';
import { DEFAULT_SETTINGS, DEFAULT_PROMPT, DEFAULT_PROMPT_KEY_EVENTS, BUILTIN_PROMPTS, LEGACY_MEMORY_PROMPTS, LEGACY_CONDENSE_PROMPTS, TRACKER_TEMPLATES } from './defaults.js';

const KEY = 'sceneArchivist';

const LOG = '[Scene Archivist]';
const UNDO_SUFFIX = ' (Archivist undo)';
let busy = false;
let operationChat = null;
let chatRevision = 0;
let operationRevision = 0;
let scopedSettings = null;
const presetKeys = new Set(Memory.PRESET_KEYS);
let pendingUndo = null;
let workbench = null;
let chatControls = null;
let archiveSource = null;
let archiveStep = '';
let registeredUnitSignature = '';
const clone = value => JSON.parse(JSON.stringify(value));
const CHAT_SETTINGS = new Set(['lorebook', 'memoryBook', 'memoryTarget', 'memoryFrom', 'memoryTo']);

function assertCurrentChat() {
    if (operationChat && (operationChat !== getContext().chat || operationRevision !== chatRevision)) throw new Error('The chat changed. Reopen the original chat and run the operation again.');
}

const worldInfoIO = createWorldInfoIO({ requestHeaders: getRequestHeaders, cache: worldInfoCache, assert: assertCurrentChat,
    onSaved: (name, data) => eventSource.emit(event_types.WORLDINFO_UPDATED, name, data) });
const readFresh = worldInfoIO.readFresh;
async function saveConfirmed(name, data) {
    try {
        if (!pendingUndo) return await worldInfoIO.saveConfirmed(name, data);
        const existing = getContext().getWorldInfoNames().includes(name);
        const current = existing ? await readFresh(name) : { entries: {} };
        for (const c of Journal.entryChanges(current, data)) {
            const entry = data.entries[c.key], r = Memory.record(entry); if (!r) continue;
            if (!c.before) r.originChat ||= String(getCurrentChatId() || '');
            r.updatedIn = String(getCurrentChatId() || ''); r.lastJobId = pendingUndo.journal.id;
        }
        if (name === settings().lorebook && data.sceneArchivistStory?.shared) data.sceneArchivistStory.books = { ...(data.sceneArchivistStory.books || {}), ...(settings().storyBooks?.[name] || {}), [name]: 'archive' };
        if (pendingUndo.bases[name] && Memory.bookHash(current) !== pendingUndo.bases[name]) throw new Error(`"${name}" changed immediately before saving. Reopen the review.`);
        Journal.stageWrite(pendingUndo.journal, name, current, data);
        await saveMetadata();
        const actual = await worldInfoIO.saveConfirmed(name, data);
        Journal.confirmWrite(pendingUndo.journal, name, actual);
        pendingUndo.bases[name] = Memory.bookHash(actual);
        await persistMeta();
        return actual;
    }
    catch (error) { toastr.error(error.message, 'Scene Archivist'); throw error; }
}
async function createBookConfirmed(name) {
    if (!name) return false;
    if (await getSanitizedFilename(name) !== name) throw new Error('Use a lorebook name without unsupported filename characters.');
    await updateWorldInfoList();
    if (getContext().getWorldInfoNames().includes(name)) return false;
    await saveConfirmed(name, { entries: {} });
    await updateWorldInfoList();
    return true;
}
const reviewCancelLabel = () => workbench?.state().job?.status === 'running' ? 'Review later' : 'Cancel';

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
        get(target, key) {
            if (CHAT_SETTINGS.has(key)) return chatSettings(target)[key];
            if (presetKeys.has(key)) {
                const overrides = activeWorkflow(target)?.settings;
                if (overrides && Object.hasOwn(overrides, key)) return overrides[key];
            }
            return target[key];
        },
        set(target, key, value) {
            if (CHAT_SETTINGS.has(key)) {
                chatSettings(target)[key] = value;
                void saveMetadata().catch(e => console.error(LOG, 'Could not save chat settings', e));
            } else {
                const overrides = presetKeys.has(key) ? activeWorkflow(target)?.settings : null;
                if (overrides) overrides[key] = value;
                else target[key] = value;
            }
            return true;
        },
    });
    return scopedSettings;
}

function profileOwner() {
    const ctx = getContext(), owner = chatOwner(ctx);
    return owner === 'card:' ? '' : owner;
}

function activeWorkflow(global) {
    const profiles = global.workflowProfiles || [];
    const owner = profileOwner();
    return profiles.find(profile => profile.id === meta().workflowProfile)
        || profiles.find(profile => profile.id === global.workflowBindings?.[owner]);
}

function profileState() {
    const global = extension_settings[KEY];
    const profile = activeWorkflow(global), owner = profileOwner();
    const chat = meta().workflowProfile, ownerBinding = global.workflowBindings?.[owner];
    const group = !!getContext().groupId;
    return { profiles: global.workflowProfiles || [], owner, chat, ownerBinding, group,
        label: profile ? `🎛️ ${profile.name} · ${profile.id === chat ? 'This chat' : group ? 'This group' : 'This character'}` : '🌐 Global workflow' };
}

async function bindProfile(scope, id, name) {
    const global = extension_settings[KEY], owner = profileOwner();
    const profiles = (global.workflowProfiles ??= []), bindings = (global.workflowBindings ??= {});
    if (name) {
        if (profiles.length >= 100) throw new Error('The workflow library can hold up to 100 profiles.');
        id = Memory.uid();
        const values = Memory.validateWorkflow(Memory.workflow(settings()));
        profiles.push({ id, name: name.slice(0, 80), settings: values });
    } else if (id && !profiles.some(profile => profile.id === id)) throw new Error('That workflow profile is missing.');
    if (scope === 'chat') {
        if (id) meta().workflowProfile = id;
        else delete meta().workflowProfile;
        await persistMeta();
    } else if (owner) {
        if (id) bindings[owner] = id;
        else delete bindings[owner];
    }
    saveSettingsDebounced();
}

function refreshScopedControls() {
    const s = settings();
    const fields = { sa_delivery: 'delivery', sa_outlet: 'outlet', sa_depth: 'depth', sa_role: 'role', sa_keepdays: 'keepDays',
        sa_mem_days: 'memoryDays', sa_mem_cap: 'memoryCap', sa_mem_prompt: 'memoryPrompt', sa_cond_above: 'condenseAbove', sa_cond_prompt: 'condensePrompt',
        sa_recall_msgs: 'recallMessages', sa_recall_max: 'recallMax', sa_keepvis: 'keepVisible', sa_tr_days: 'trackerDays' };
    for (const [id, key] of Object.entries(fields)) $('#' + id).val(s[key]);
    for (const [id, key] of Object.entries({ sa_mem_auto: 'memoryAuto', sa_tr_auto: 'trackerAuto', sa_recall: 'recall', sa_review: 'review', sa_hide: 'hideArchived' })) $('#' + id).prop('checked', s[key]);
    $('.sa-d-outlet').toggle(s.delivery === 'outlet');
    $('.sa-d-depth').toggle(s.delivery === 'depth');
    Core.registerUnits([s.unit, ...s.promptLibrary.map(prompt => prompt.unit)]);
    renderPromptLib(); renderTrackers(); void refreshLorebookList();
}

function memoryPeers() {
    const activeBooks = [chat_metadata[METADATA_KEY], meta().priorChatLorebook, ...selected_world_info];
    const candidates = [...Object.keys(extension_settings), ...activeBooks.filter(Boolean)];
    return [...new Set(candidates.filter(name => /memory[ _-]?books|char[ _-]?memory|character[ _-]?memory|smart[ _-]?memory|qvink|messagesummarize|rememory/i.test(name)))];
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
    const data = await readFresh(s.lorebook);
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
    const ok = await createBookConfirmed(name);
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
    const data = await readFresh(s.lorebook);
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
    const nativeTokens = Math.round((getMaxContextTokens() || 0) * world_info_budget / 100);
    const nativeLimit = world_info_budget_cap > 0 ? Math.min(nativeTokens, world_info_budget_cap) : nativeTokens;
    const vulnerable = entries.filter(entry => !entry.disable && !entry.ignoreBudget);
    out.push({ level: vulnerable.length && nativeLimit < 1000 ? 'warn' : 'ok',
        text: `SillyTavern World Info budget · ~${nativeLimit.toLocaleString()} tokens for entries that use it. ${vulnerable.length} archive entries count against it.` });
    out.push({ level: 'ok', text: world_info_recursive
        ? `World Info recursion is on${world_info_max_recursion_steps > 0 ? ` · up to ${world_info_max_recursion_steps} loops` : ''}. Scene Archivist entries keep their own recursion rules.`
        : 'World Info recursion is off. Direct keyword and always-on entries can still load.' });
    if (!s.prompt.trim()) out.push({ level: 'bad', text: 'The archivist prompt is empty.' });
    setStatus(out);
    return out;
}

async function fixOutlet() {
    if (busy) return;
    const s = settings(); const o = coreOpts();
    if (!s.lorebook) return;
    const data = await readFresh(s.lorebook);
    let n = 0;
    for (const e of Object.values(data.entries ?? {})) {
        if (!Core.classifyEntry(e)) continue;
        if (e.constant && !e.ignoreBudget) { e.ignoreBudget = true; n++; }
    }
    n += Core.convertDelivery(data, o);
    await saveConfirmed(s.lorebook, data);
    try { reloadEditor(s.lorebook); } catch { /* editor closed */ }
    toastr.success(n ? `Updated ${n} settings on log entries.` : 'Nothing to fix.');
    await checkSetup();
}

function assignChatLorebook(name) {
    const previous = chat_metadata[METADATA_KEY];
    if (previous && previous !== name && !settings().storyBooks?.[previous]) meta().priorChatLorebook = previous;
    chat_metadata[METADATA_KEY] = name;
}

async function attachToChat() {
    if (busy) return;
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick a lorebook first.'); return; }
    assignChatLorebook(s.lorebook);
    await saveMetadata();
    $('.chat_lorebook_button').addClass('world_set');
    toastr.success(`"${s.lorebook}" is now this chat's lorebook.`);
    await checkSetup();
}

// ---------------------------------------------------------------- keywords

async function fillKeys(plan, data, supplied = null) {
    const s = settings();
    const avoid = avoidList();
    const items = [...plan.adds.filter(a => a.include).map(a => ({ ref: a, content: a.content })), ...plan.demotions.filter(d => d.needsKeys).map(d => ({ ref: d, content: d.content }))];
    if (!items.length) return;
    const existing = Object.values(data.entries ?? {}).filter(e => Core.classifyEntry(e)).map(e => e.content);
    const corpus = [...existing, ...items.map(i => i.content)];
    const heur = items.map(i => Core.suggestKeys(i.content, corpus.filter(c => c !== i.content), { avoid }));
    let ai = null;
    if (supplied) {
        ai = plan.adds.map((item, index) => Array.isArray(supplied[index]) ? supplied[index] : []);
    } else if (s.keyMode === 'ai') {
        try {
            const kp = Core.buildKeywordPrompt(items, avoid);
            ai = (await sideJson({ prompt: kp.prompt, system: kp.system, maxTokens: 1200 }, t => Core.parseKeywordResponse(t, items.length), 'keywords')).value;
            if (!ai) plan.warnings.push('The keyword request did not return usable JSON, so automatic keywords were used.');
        } catch (e) {
            if (workbench?.queue.running && workbench.liveState().job?.status !== 'running') throw e;
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
    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: 'Write to lorebook', cancelButton: reviewCancelLabel(), wide: true, large: true, allowVerticalScrolling: true });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return false;
    const parseKeys = (v) => Core.withVariants(String(v).split(',').map(x => x.trim()).filter(Boolean));
    for (const { a, d } of refs.adds) { a.include = d.querySelector('input[type=checkbox]').checked; a.keys = parseKeys(d.querySelector('.sa-keys').value); a.content = d.querySelector('textarea').value.trim(); }
    for (const { st, d } of refs.states) { st.include = d.querySelector('input[type=checkbox]').checked; st.content = d.querySelector('textarea').value.trim(); }
    for (const { dm, d } of refs.demotions) { dm.include = d.querySelector('input[type=checkbox]').checked; const k = d.querySelector('.sa-keys'); if (k) dm.keys = parseKeys(k.value); }
    return true;
}

// ---------------------------------------------------------------- main flow

function progressSnapshot() {
    const m = meta(), w = m.workbench || {}, s = settings();
    return clone({ ranges: m.ranges || [], archivedThrough: m.archivedThrough ?? -1, lastDay: m.lastDay ?? null,
        at: m.at ?? null, messages: m.messages ?? null, memoryProgress: s.memoryProgress?.[s.lorebook] ?? null,
        coverage: w.coverage || {}, applied: w.applied || [] });
}
function visibilitySnapshot() { return (getContext().chat || []).map(m => ({ signature: messageSignature(m), hidden: !!m.is_system })); }
async function persistMeta() {
    if (pendingUndo && pendingUndo.journal.status !== 'undone') {
        pendingUndo.journal.progress.after = progressSnapshot(); pendingUndo.journal.visibilityAfter = visibilitySnapshot();
    }
    await saveMetadata();
}
function beginUndoWrite() {
    assertCurrentChat();
    const m = meta(), job = m.workbench?.job, active = job?.status === 'running';
    const journals = (m.journals ??= []), id = active ? job.id : Memory.uid();
    let journal = journals.find(j => j.id === id && j.status !== 'undone');
    if (!journal) {
        journal = Journal.makeJournal({ id, archive: settings().lorebook, chatId: String(getCurrentChatId() || ''), label: active ? job.kind : 'Memory update', progress: progressSnapshot(), visibility: visibilitySnapshot() });
        journals.push(journal);
    }
    pendingUndo = { journal, bases: {} };
}
function messageSignature(m) { return Memory.messageHash(m); }
async function saveUndoSnapshot(name, data) {
    assertCurrentChat();
    if (!pendingUndo) throw new Error('No journal was started.');
    pendingUndo.bases[name] = Memory.bookHash(data);
    await saveMetadata();
    $('#sa_undo').prop('disabled', !undoBooks().length);
}
const latestJournal = () => [...(chat_metadata?.[KEY]?.journals || [])].reverse().find(j => j.archive === settings().lorebook && j.status !== 'undone' && (j.changes.some(c => c.status !== 'undone') || ['entries undone', 'restoring progress', 'undoing'].includes(j.status)));
const undoBooks = () => Memory.unique((latestJournal()?.changes || []).map(c => c.book));
async function undoLast() {
    if (busy) { toastr.info('Wait for the current operation to finish before using Undo.'); return; }
    const journal = latestJournal();
    if (!journal) { toastr.info('There is no entry restore point yet. New writes create one. Older full-book restore points are kept in chat data but are not applied over later edits.'); return; }
    busy = true; operationChat = getContext().chat; operationRevision = chatRevision; pendingUndo = null;
    try {
        const load = async () => {
            await updateWorldInfoList();
            const archive = settings().lorebook, data = await readFresh(archive);
            if (!data) throw new Error('Select the original archive before opening Undo.');
            const names = Memory.unique([...Object.keys(journal.receipts), ...Object.keys(settings().storyBooks?.[archive] || {}), ...Object.keys(data.sceneArchivistStory?.books || {}), archive, memoryBookName()]);
            const available = getContext().getWorldInfoNames();
            // A missing managed book could contain a dependent. Do not guess that it is empty.
            const managed = names.filter(n => n !== memoryBookName() || available.includes(n) || Object.hasOwn(journal.receipts, n) || Object.hasOwn(data.sceneArchivistStory?.books || {}, n));
            return Object.fromEntries(await Promise.all(managed.map(async n => [n, n === archive ? data : await readFresh(n)])));
        };
        const books = await load(), plan = Journal.planUndo(journal, books);
        const root = document.createElement('div'); root.className = 'sa-review';
        root.innerHTML = `<h3>Undo ${esc(journal.label)}</h3><p>${plan.safe.length} ${plan.safe.length === 1 ? 'change can' : 'changes can'} be undone; ${plan.conflicts.length} must be kept.</p>`;
        if (journal.changes.every(c => c.status === 'undone')) root.insertAdjacentHTML('beforeend', '<p>Entry changes are already undone. Continue to finish restoring matching progress and visibility.</p>');
        for (const c of plan.conflicts) { const p = document.createElement('p'); p.className = 'sa-warnline'; p.textContent = `${c.title}: ${c.reason}`; root.append(p); }
        for (const c of plan.safe) { const p = document.createElement('p'); p.textContent = `${c.before ? 'Restore' : 'Remove'}: ${c.title} (${c.book})`; root.append(p); }
        if (!plan.safe.length && !plan.already.length && !journal.changes.every(c => c.status === 'undone')) { await new Popup(root, POPUP_TYPE.TEXT, '', { wide: true, okButton: 'Close' }).show(); return; }
        if ((await new Popup(root, POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Undo safe changes', cancelButton: 'Keep everything' }).show()) !== POPUP_RESULT.AFFIRMATIVE) return;
        const fresh = await load(), final = Journal.planUndo(journal, fresh);
        if (!Journal.same(final.safe.map(c => [c.book, c.key]).sort(), plan.safe.map(c => [c.book, c.key]).sort())) throw new Error('The Undo plan changed while you reviewed it. Reopen Undo.');
        const desired = Journal.applyUndo(fresh, final);
        journal.status = 'undoing'; await saveMetadata();
        // Removing derived books first leaves source entries available after an interrupted Undo.
        const touched = Memory.unique([...final.safe.map(c => c.book), ...final.already.map(c => c.book), ...(final.complete ? Object.keys(journal.receipts) : [])]).sort((a, b) => (a === settings().lorebook ? 1 : 0) - (b === settings().lorebook ? 1 : 0));
        for (const name of touched) {
            const latest = await readFresh(name);
            if (!Journal.same(latest, fresh[name])) throw new Error(`"${name}" changed immediately before Undo. Reopen Undo to continue safely.`);
            if (!Journal.same(latest, desired[name])) await worldInfoIO.saveConfirmed(name, desired[name]);
            Journal.confirmUndo(journal, name, await readFresh(name), final); await saveMetadata();
            try { reloadEditor(name); } catch { /* editor closed */ }
        }
        if (journal.changes.every(c => c.status === 'undone')) {
            journal.status = 'restoring progress'; await saveMetadata();
            const current = progressSnapshot(), before = journal.progress.before, after = journal.progress.after;
            // Restore only fields that still equal this job's recorded after-state.
            for (const key of ['ranges', 'archivedThrough', 'lastDay', 'at', 'messages']) if (Journal.same(current[key], after[key])) meta()[key] = clone(before[key]);
            for (const key of ['coverage', 'applied']) if (Journal.same(current[key], after[key])) (meta().workbench ??= {})[key] = clone(before[key]);
            if (Journal.same(current.memoryProgress, after.memoryProgress)) {
                settings().memoryProgress ??= {};
                if (before.memoryProgress == null) delete settings().memoryProgress[journal.archive]; else settings().memoryProgress[journal.archive] = before.memoryProgress;
            }
            const chat = getContext().chat || [];
            for (let i = 0; i < journal.visibility.length; i++) {
                const saved = journal.visibility[i], expected = journal.visibilityAfter?.[i];
                if (!chat[i] || !expected || messageSignature(chat[i]) !== saved.signature || !!chat[i].is_system !== expected.hidden) continue;
                if (!!chat[i].is_system !== saved.hidden) await hideChatMessageRange(i, i, !saved.hidden);
            }
            const job = meta().workbench?.job;
            if (job?.id === journal.id) { job.status = 'canceled'; job.error = 'This job was undone.'; }
        }
        if (journal.changes.every(c => c.status === 'undone')) journal.status = 'undone';
        saveSettingsDebounced(); await saveMetadata();
        toastr.success(journal.status === 'undone' ? 'The job was undone. Later unrelated records were kept.' : 'Safe changes were undone. Conflicting work and its progress were kept.');
    } catch (e) { if (journal.changes.every(c => c.status === 'undone')) journal.status = 'restoring progress'; toastr.error('Undo is incomplete: ' + e.message); }
    finally { busy = false; operationChat = null; }
    await refreshChatUi();
}

async function commit(plan, parsed, name, expectedHash = '') {
    assertCurrentChat();
    if (archiveStep && workbench?.state().job?.status !== 'running') throw new Error('The archive job was paused or canceled before the write. Its output is saved for review.');
    beginUndoWrite();
    const o = coreOpts();
    const data = (await readFresh(name)) ?? { entries: {} };
    if (expectedHash && Memory.bookHash(data) !== expectedHash) throw new Error('The archive changed while you were reviewing. The response is saved; review it against the new version before writing.');
    const before = clone(data);
    if (archiveSource && !Memory.checkSource(archiveSource, workbench?.sourceId() || archiveSource.chatId, getContext().chat || []).valid) throw new Error('The transcript changed while the output was being reviewed. No archive write was made.');
    await saveUndoSnapshot(name, data);
    const makeEntry = (d) => createWorldInfoEntry(name, d);
    const rep = Core.applyPlan(data, plan, parsed, o, makeEntry);
    const changed = Memory.captureChanges(data, before, Core.classifyEntry, { storyId: workbench?.state().storyId || '', source: archiveSource || undefined, reason: 'Archive write' });
    for (const e of Object.values(data.entries)) if (Memory.record(e)?.storyId === (workbench?.state().storyId || '')) e.sceneArchivistArchive = name;

    if (archiveStep) data.sceneArchivistReceipts = Memory.unique([...(data.sceneArchivistReceipts || []), archiveStep]);
    await saveConfirmed(name, data);
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

async function prepareArchive(text, data, source = archiveSource, placement = null) {
    const s = settings(), answer = archiveAnswer(text);
    const parsed = Core.parseArchivistOutput(answer.raw);
    if (placement) placeSharedUnits(data, parsed.entries, placement);
    else validateSharedUnits(data, parsed.entries, source);
    if (!parsed.entries.length && !Object.keys(parsed.states).length) {
        throw new Error(`I could not find any ${s.unit || 'story unit'} entries or states in that output. The draft remains available.`);
    }
    const plan = Core.planChanges(data, parsed, { ...coreOpts(), source });
    const deliveryChanges = Object.values(data.entries ?? {}).filter(e => Core.classifyEntry(e) && !Core.matchesDelivery(e, coreOpts())).length;
    if (deliveryChanges) plan.warnings.push(`${deliveryChanges} existing log entries use a different delivery setting. Writing will move them to ${deliveryLabel(coreOpts())}.`);
    await fillKeys(plan, data, placement ? answer.keywords : null);
    return { parsed, plan };
}

async function handleOutput(text) {
    assertCurrentChat();
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick or create a lorebook first.'); return false; }
    const data = (await readFresh(s.lorebook)) ?? { entries: {} };
    const { parsed, plan } = await prepareArchive(text, data);
    if (s.review) {
        const ok = await showReview(plan, parsed, s.lorebook);
        if (!ok) { toastr.info(archiveStep ? 'Review postponed. Use Resume / review to reopen the prepared result.' : 'Cancelled. Nothing was written.'); return false; }
    }
    if (archiveSource && (plan.adds.some(a => !a.include) || plan.states.some(a => !a.include))) throw new Error('This transcript pass was only partly selected. Its coverage cannot be marked complete. Keep all source results checked, or use Review later and choose a smaller range.');
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
    if (!(await createBookConfirmed(name))) { toastr.error('Could not create a lorebook.'); return false; }
    await updateWorldInfoList();
    await refreshLorebookList(name);
    if (!isLorebookActive(name)) { assignChatLorebook(name); try { await saveMetadata(); } catch { /* ignore */ } $('.chat_lorebook_button').addClass('world_set'); }
    saveSettingsDebounced();
    toastr.info(`Created "${name}" and attached it to this chat.`);
    return true;
}

async function runSummarize(opts = {}) {
    try { return await workbench.archiveWorkflow(opts?.thorough === true); }
    catch (e) { console.error(LOG, e); toastr.error(e?.message ?? e); return false; }
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
    if (wrote && settings().memoryAuto) await runMemories();
    if ((getContext().chat !== startingChat || chatRevision !== startingRevision)) return;
    if (wrote && settings().trackerAuto) await runTrackers(null, true);
}

// ---------------------------------------------------------------- side calls (keywords, recall, memories, condense)

let sideWarned = false;
const issues = [];
const noteIssue = (msg) => { issues.push(`${new Date().toISOString().slice(11, 19)} ${msg}`); if (issues.length > 12) issues.shift(); };

/** Ask for JSON; if the reply cannot be parsed, ask once more, firmly. Returns {value, text}. */
async function sideJson(req, parse, label) {
    const request = value => workbench?.queue.running ? workbench.call(value, label) : sideCall(value);
    let text = await request(req);
    let value = parse(text);
    if (value == null) {
        noteIssue(`${label}: first reply was not usable JSON, retrying`);
        text = await request({ ...req, prompt: req.prompt + '\n\nYour previous reply could not be read. Reply again with ONLY the JSON object, no commentary and no code fences.' });
        value = parse(text);
        if (value == null) noteIssue(`${label}: retry also failed`);
    }
    return { value, text };
}

async function copyDiagnostics() {
    const s = settings(); const ctx = getContext();
    const data = s.lorebook ? await readFresh(s.lorebook).catch(() => null) : null;
    const entries = data ? Object.values(data.entries ?? {}) : [];
    const m = chat_metadata?.[KEY] ?? {};
    const lines = [
        `Scene Archivist ${VERSION}`,
        `SillyTavern: ${typeof ctx.version === 'string' ? ctx.version : 'unknown'} | API: ${main_api} | ${navigator.userAgent}`,
        `Delivery: ${s.delivery} (depth ${s.depth}, role ${s.role}, outlet "${s.outlet}") | Archive mode: ${s.archiveMode} | Keywords: ${s.keyMode}`,
        `Side-call profile: ${s.sideProfile || '(current model)'} | Recall: ${s.recall ? 'on' : 'off'} | Memories auto: ${s.memoryAuto ? 'on' : 'off'} (${s.memoryTarget}${s.memoryTarget === 'separate' ? ', book "' + memoryBookName() + '", active: ' + (selected_world_info.includes(memoryBookName()) ? 'yes' : 'no') : ''})`,
        `Lorebook: ${s.lorebook || '(none)'} | entries: ${entries.length} | attached to chat: ${isLorebookActive(s.lorebook) ? 'yes' : 'no'}`,
        `Prompt: ${s.promptId} (${String(s.prompt ?? '').length} chars) | model-aware range processing | auto-hide ${s.hideArchived ? 'on, keep ' + s.keepVisible : 'off'}`,
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
    const profiles = getContext().extensionSettings?.connectionManager?.profiles ?? [];
    for (const [selector, setting] of [['#sa_side_profile', 'sideProfile'], ['#sa_archive_profile', 'archiveProfile']]) {
        const select = $(selector);
        select.empty().append($('<option>').val('').text('Current SillyTavern model'));
        for (const profile of profiles) select.append($('<option>').val(profile.id).text(profile.name));
        if (s[setting] && !profiles.some(profile => profile.id === s[setting])) select.append($('<option>').val(s[setting]).text('Saved profile unavailable'));
        select.val(s[setting] || '');
    }
}

async function readReferences(refs) {
    const grouped = new Map();
    for (const item of refs) {
        if (!grouped.has(item.book)) grouped.set(item.book, []);
        grouped.get(item.book).push(item);
    }
    const chunks = [];
    for (const [name, selections] of grouped) {
        const book = await readFresh(name);
        if (!book) throw new Error(`Reference lorebook "${name}" is unavailable. Update the selection before running.`);
        for (const entry of Object.values(book.entries || {})) {
            if (!entry.content || !selections.some(item => item.uid == null || String(item.uid) === String(entry.uid))) continue;
            chunks.push(`[Reference: ${name} / ${entry.comment || entry.uid}]
${entry.content}`);
        }
        if (selections.some(item => item.uid != null && !Object.values(book.entries || {}).some(entry => String(entry.uid) === String(item.uid)))) {
            throw new Error(`A selected entry in "${name}" was removed. Update the reference selection.`);
        }
    }
    return chunks.join('\n\n');
}

async function readDiaryLore(card) {
    const ctx = getContext();
    const name = ctx.name2;
    const active = characters[this_chid];
    const supplemental = world_info?.charLore?.find(item => item.name === getCharaFilename(this_chid))?.extraBooks || [];
    const books = Memory.unique([chat_metadata[METADATA_KEY], meta().priorChatLorebook, (card || active)?.data?.extensions?.world,
        ...(!card || card?.name === name ? supplemental : []), power_user.persona_description_lorebook]);
    const chunks = [];
    for (const book of books.filter(book => ctx.getWorldInfoNames().includes(book))) {
        const data = await readFresh(book);
        for (const e of Object.values(data?.entries || {})) {
            if (e.disable || !e.content || Memory.record(e) || Core.classifyEntry(e)) continue;
            chunks.push('[' + book + ' / ' + (e.comment || e.uid) + ']\n' + e.content);
        }
    }
    return chunks.join('\n\n');
}

function flowModelInfo(profile) {
    const current = getContext();
    if (!profile) return { name: String(current.getCurrentModel?.() || (main_api === 'openai' ? oai_settings.openai_model : '') || 'Current SillyTavern model'), context: getMaxContextTokens(), output: getMaxResponseTokens() };
    const selected = current.extensionSettings?.connectionManager?.profiles?.find(p => p.id === profile);
    if (!selected) throw new Error('The selected connection profile is unavailable. Choose an available profile or retry on the current model.');
    const api = current.CONNECT_API_MAP?.[selected.api]?.selected || 'openai';
    const preset = current.getPresetManager?.(api)?.getCompletionPresetByName?.(selected.preset);
    const context = api === 'textgenerationwebui' ? preset?.max_length : preset?.openai_max_context;
    const output = api === 'textgenerationwebui' ? preset?.genamt : preset?.openai_max_tokens;
    return { name: selected.name, context: Number(context || selected.context_length) || 0,
        output: Number(output || selected.max_tokens) || 0 };
}

async function buildFlowContext(req) {
    let prompt;
    const capture = (data, dryRun) => { if (dryRun) prompt = data.prompt; };
    eventSource.on(event_types.GENERATE_AFTER_DATA, capture);
    try {
        await Generate('quiet', { quiet_prompt: req.system + '\n\n' + req.prompt, force_name2: true }, true);
        assertCurrentChat();
        if ((!Array.isArray(prompt) && typeof prompt !== 'string') || !prompt.length) throw new Error('SillyTavern did not supply a chat-context preview for this connection.');
        const material = Array.isArray(prompt) ? prompt.map(message => message?.content).flat(Infinity).filter(text => typeof text === 'string').join('\n') : prompt;
        const boundary = req.prompt.trim().split('\n').filter(Boolean).at(-1);
        if (boundary && !material.includes(boundary)) throw new Error('SillyTavern trimmed the selected evidence while building chat context. Raise its context limit or turn off Include SillyTavern chat context.');
        return prompt;
    } finally {
        eventSource.removeListener(event_types.GENERATE_AFTER_DATA, capture);
    }
}

async function sendFlowRequest(req, profile) {
    const prompt = req.assembled ?? req.prompt;
    const messages = Array.isArray(prompt) ? prompt : [
        ...(!req.assembled && req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: prompt },
    ];
    if (!profile) return generateRaw({ prompt, systemPrompt: req.assembled ? '' : req.system, responseLength: req.maxTokens });
    const service = getContext().ConnectionManagerRequestService;
    if (!service?.sendRequest) throw new Error('Connection Manager is unavailable. Re-enable it or retry on the current model.');
    const result = await service.sendRequest(profile, messages, req.maxTokens);
    return typeof result === 'string' ? result : result?.content;
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
        if (busy || workbench?.scanSuppressed || workbench?.vectorScan) return;
        await workbench?.onWorldInfoActivated(entries);
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
            if (!candidate && e.constant) triggers.push('always on');
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
    sum.text(`Last World Info scan: ${lastView.items.length} archive entries, about ${fmtTok(total)} tokens${ctx ? ` (${Math.round(total / ctx * 100)}% of the ${fmtTok(ctx)} context)` : ''}. Keyword activations ${fmtTok(by('keyword'))}, vector matches ${fmtTok(by('native vector'))}, always on ${fmtTok(by('always on'))}, AI Recall ${fmtTok(by('recall'))}. Reasons can overlap.`);
    list.html(lastView.items.map(i => `<div class="sa-viewrow"><span class="sa-badge">${esc(i.reason)}</span> ${esc(i.title)} <span class="sa-hint">${fmtTok(i.tokens)}</span></div>`).join(''));
}

// ---------------------------------------------------------------- condense memories

async function runCondense() {
    try { return await workbench.startMemoryCondense(); }
    catch (e) { toastr.error(e?.message ?? e); }
}

// ---------------------------------------------------------------- archive ledger and message visibility

const meta = () => (chat_metadata[KEY] ??= {});

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
        chat_metadata[KEY].ranges.at(-1).source = workbench ? workbench.source([r]) : Memory.sourceSnapshot('', chat, [r]);
    }
    await persistMeta();
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

function renderLedger() {
    const sum = $('#sa_ledger_sum'); const list = $('#sa_ledger');
    if (!sum.length) return;
    const chat = getContext().chat ?? [];
    const m = chat_metadata?.[KEY] ?? {};
    const pend = uncoveredArchiveMessages(chat, m);
    const tok = pend.reduce((n, x) => n + Core.estimateTokens(x.text), 0);
    const through = m.archivedThrough ?? -1;
    const coverage = through >= 0
        ? `Saved coverage reaches message ${through}${m.lastDay ? ` (${settings().unit} ${m.lastDay})` : ''}.`
        : (Core.archivedRanges(m).length ? 'Some ranges are archived. Earlier gaps remain.' : 'Nothing archived in this chat yet.');
    const remaining = `${pend.length} ${pend.length === 1 ? 'message remains' : 'messages remain'} unarchived${pend.length ? ` (about ${fmtTok(tok)} input tokens)` : ''}.`;
    sum.text(`${coverage} ${remaining}`);
    const rows = Core.ledgerRows(m);
    list.html(rows.map(r => { const row = m.ranges[r.i]; const visible = chat.slice(row.from, row.to + 1).filter(x => !x.is_system).length; return `<div class="sa-ledgerrow"><b>Messages ${esc(r.label)}</b> <span class="sa-badge">summarized</span> <span class="sa-hint">${visible} visible / ${row.to - row.from + 1} total · ${esc(r.note.replace(/Day/g, settings().unit))}</span> <a class="sa-ledgerlink" data-i="${r.i}">${visible ? 'hide exactly this range' : 'show exactly this range'}</a><button type="button" class="menu_button" data-sa-action="ledgerForget" data-row="${r.i}">🧽 Mark unprocessed</button><button type="button" class="menu_button" data-sa-action="ledgerRedo" data-row="${r.i}">🔄 Redo summaries</button></div>`; }).join('') || '<div class="sa-hint">No summarized ranges yet. Use Pick your messages for an exact interval.</div>');
    list.find('.sa-ledgerlink').on('click', async function () { await toggleLedgerRow(Number($(this).data('i'))); });
    workbench?.layout?.help.refresh(list[0]);
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
    const data = s.lorebook ? await readFresh(s.lorebook) : null;
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
        const names = getContext().getWorldInfoNames();
        const privateBook = workbench?.state().branchBooks?.[w];
        if (privateBook && s.storyBooks[s.lorebook]?.[privateBook] && names.includes(privateBook)) return privateBook;
        if (w && names.includes(w)) return w;
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
        const data = await readFresh(book);
        if (settings().lorebook !== archive) return;
        for (const e of Object.values(storyMemoryData(data ?? {}, book).entries ?? {})) {
            if ((!Memory.record(e) && Core.classifyEntry(e)?.type !== 'memory') || e.disable || seen.has(`${book}::${e.uid}`)) continue;
            groups.chatLore.push({ ...e, world: book });
            seen.add(`${book}::${e.uid}`);
        }
    }
    if (workbench) await workbench.filterEntries(groups);
}

function mountRangeMarkers(messageIndex) {
    chatControls?.mount(messageIndex);
}

const chatName = name => String(name ?? '').replace(/\.jsonl$/i, '');
const groupFor = ctx => ctx.groupId == null ? null : ctx.groups?.find(group => String(group.id) === String(ctx.groupId));
const chatOwner = ctx => ctx.groupId != null ? `group:${ctx.groupId}` : `card:${ctx.characters?.[ctx.characterId]?.avatar ?? ''}`;
const recentRenames = new Map();
async function listChatFiles() {
    const ctx = getContext();
    const group = groupFor(ctx);
    if (ctx.groupId != null) return group?.chats?.map(chatName) ?? null;
    const avatar = ctx.characters?.[ctx.characterId]?.avatar;
    if (!avatar) return null;
    try {
        const response = await fetch('/api/characters/chats', { method: 'POST', headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar, simple: true }) });
        if (!response.ok) return null;
        return Object.values(await response.json()).map(item => chatName(item.file_name));
    } catch { return null; }
}

function onChatRenamed({ avatarId, groupId, oldFileName, newFileName }) {
    const owner = groupId != null ? `group:${groupId}` : `card:${avatarId ?? ''}`;
    const oldName = chatName(oldFileName), newName = chatName(newFileName);
    if (!oldName || !newName) return;
    recentRenames.set(JSON.stringify([owner, oldName, newName]), Date.now());
    if (recentRenames.size > 64) recentRenames.delete(recentRenames.keys().next().value);
    if (owner === chatOwner(getContext()) && newName === chatName(getCurrentChatId())) return workbench?.refresh();
}

function currentAvatar(avatar) {
    const changes = settings().avatarRenames || {};
    const seen = new Set();
    while (Object.hasOwn(changes, avatar) && !seen.has(avatar)) {
        seen.add(avatar);
        avatar = changes[avatar];
    }
    return avatar;
}

function groupSpeaker() {
    const ctx = getContext(), group = groupFor(ctx);
    if (!group) return null;
    return { speaker: characters[this_chid]?.avatar || '', members: (group.members || []).map(avatar => {
        const card = ctx.characters.find(character => character?.avatar === avatar);
        return { avatar, name: card?.name || '', aliases: card?.data?.nickname ? [card.data.nickname] : [] };
    }) };
}

async function refreshChatUi() {
    const s = settings();
    lastView = null; lastRemindAt = 0;
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
    if (workbench) {
        refreshScopedControls();
        workbench.syncOptions();
        await workbench.onChatOpened();
    }
    chatControls?.syncRange();
    mountRangeMarkers();
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

async function runMemories() {
    try { return await workbench.startMemories(); }
    catch (e) { console.error(LOG, e); toastr.error(e?.message ?? e); }
}

// ---------------------------------------------------------------- trackers and recap

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

async function runTrackers(onlyId = null, quiet = false) {
    try { return await workbench.startTrackers(onlyId, quiet); }
    catch (e) {
        if (!quiet) toastr.error(e?.message ?? e);
        console.warn(LOG, e);
        return false;
    }
}

async function recap() {
    try { return await workbench.recap(); }
    catch (e) { toastr.error(e?.message ?? e); }
}

// ---------------------------------------------------------------- Recall

function recentMessages(n) {
    const list = (getContext().chat ?? []).filter(m => !m.is_system && String(m.mes ?? '').trim());
    return list.slice(-Math.max(1, n)).map(m => `${m.name}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n');
}

async function runRecall() {
    const s = settings();
    const data = await readFresh(s.lorebook);
    if (!data) return null;
    const recent = recentMessages(Number(s.recallMessages) || 4);
    const index = Core.buildRecallIndex(data, { limit: 120, recentText: recent });
    if (!index.length || !recent) return { picked: [] };
    const max = Math.max(1, Number(s.recallMax) || 4);
    const rp = Core.buildRecallPrompt(index, recent, max);
    const { value: ids, text } = await sideJson({ prompt: rp.prompt, system: rp.system, maxTokens: 300 }, t => Core.parseRecallResponse(t, index, max), 'recall');
    if (ids === null) { console.warn(LOG, 'recall reply was not usable', text); return { picked: [], bad: true }; }
    return { picked: index.filter(x => ids.includes(x.id)) };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

function showRecallResult(r) {
    const msg = r?.bad ? 'The model gave an unusable answer, so only keywords were used.'
        : r?.picked?.length ? `Would load: ${r.picked.map(p => p.title).join(' | ')}` : `Would load: nothing extra`;
    $('#sa_recall_last').text(msg);
}

async function onGenerationStarted(type, params, dryRun) {
    try { await workbench.beforeGeneration(type, params, dryRun); }
    catch (e) { console.warn(LOG, e); }
}

async function testRecall() {
    const s = settings();
    if (!s.lorebook) { toastr.warning('Pick a lorebook first.'); return; }
    if (!(getContext().chat?.length)) { toastr.warning('Open a chat first.'); return; }
    if (recallBusy) return;
    recallBusy = true;
    try {
        const r = await withTimeout(runRecall(), 60000);
        showRecallResult(r);
        toastr.info(r?.picked?.length ? 'Would load: ' + r.picked.map(p => p.title).join(', ') : (r?.bad ? 'Unusable answer from the model.' : 'Nothing extra needed.'), 'Recall test');
    } catch (e) { toastr.error('Recall test failed: ' + (e?.message ?? e)); } finally { recallBusy = false; }
}

// ---------------------------------------------------------------- reminder

let lastRemindAt = 0;
async function onMessageReceived(index, type) {
    workbench?.extras?.prompt.receive(index, type);
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
      <label class="checkbox_label"><input id="sa_hide" type="checkbox"><span>Hide messages once archived</span></label>
      <div class="sa-row"><label for="sa_keepvis">Keep visible</label><input id="sa_keepvis" class="text_pole" type="number" min="0" max="200" title="How many of the newest messages stay visible"></div>
      <div class="sa-row"><input id="sa_through" class="text_pole" type="number" min="0" placeholder="message #"><input id="sa_through_set" class="menu_button" type="button" value="Mark archived through"><input id="sa_ledger_import" class="menu_button" type="button" value="Import list"></div>
    </div></details>

    <details class="sa-card"><summary>🧠 Memory settings and prompt</summary><div class="sa-body">
      <div class="sa-row"><label for="sa_mem_target">Save in</label><select id="sa_mem_target" class="text_pole"><option value="separate">A separate memories lorebook</option><option value="archive">The archive lorebook</option><option value="character">Each character's own lorebook</option></select></div>
      <div class="sa-row"><label for="sa_mem_book">Lorebook name</label><input id="sa_mem_book" class="text_pole" type="text" placeholder="(archive name) Memories"></div>
      <label class="checkbox_label"><input id="sa_mem_auto" type="checkbox"><span>Also create memories when archiving new messages</span></label>
      <div class="sa-sub">Memory prompt</div>
      <textarea id="sa_mem_prompt" class="text_pole" rows="8"></textarea>
      <div class="sa-row"><input id="sa_mem_prompt_reset" class="menu_button" type="button" value="Reset prompt"></div>
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

    <details class="sa-card"><summary>📺 Previously on...</summary><div class="sa-body">
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
      <div class="sa-row"><label for="sa_archive_profile">Archive model</label><select id="sa_archive_profile" class="text_pole"></select></div>
      <div class="sa-row"><label for="sa_side_profile">Memory and tracker model</label><select id="sa_side_profile" class="text_pole" title="Keywords, Recall, memories and Condense can use a cheaper Connection Manager profile"></select><input id="sa_side_test" class="menu_button" type="button" value="Test"></div>
      <div class="sa-row"><label for="sa_keymode">Keywords</label><select id="sa_keymode" class="text_pole"><option value="ai">Ask the model</option><option value="heuristic">Automatic only</option></select></div>
      <div class="sa-row"><label for="sa_maxtok">Max reply tokens</label><input id="sa_maxtok" class="text_pole" type="number" min="0" max="64000" title="0 uses your preset's response length"></div>
      <div class="sa-row"><label for="sa_remind">Remind me every</label><input id="sa_remind" class="text_pole" type="number" min="0" max="500" title="Messages, 0 = never"></div>
      <label class="checkbox_label"><input id="sa_autoarch" type="checkbox"><span>Archive automatically instead of reminding</span></label>
      <label class="checkbox_label"><input id="sa_review" type="checkbox"><span>Review before writing</span></label>
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
async function jumpToChatMessage(index, root) {
    const ctx = getContext(), origin = ctx.chat, identity = getCurrentChatId(), message = ctx.chat[index];
    if (!message) throw new Error('That message is no longer in this chat.');
    const first = Number(document.querySelector('#chat .mes[mesid]')?.getAttribute('mesid'));
    if (Number.isInteger(first) && index < first) await showMoreMessages(first - index);
    if (origin !== getContext().chat || identity !== getCurrentChatId() || origin[index] !== message) return;
    const target = document.querySelector(`#chat .mes[mesid="${index}"]`);
    if (!target) throw new Error('Load the earlier messages in this chat to jump there.');
    root.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    for (const panel of document.querySelectorAll('dialog[open] :is(.sa-timeline, .sa-popwrap)')) {
        panel.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    }
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    target.classList.add('sa-chat-jump');
    setTimeout(() => target.classList.remove('sa-chat-jump'), 2400);
}

async function openPanelPopup() {
    const panel = document.querySelector('.sa-panel');
    if (!panel || panel.dataset.popped) return;
    renderLedger();
    const home = panel.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'sa-popwrap';
    panel.dataset.popped = '1';
    wrap.append(panel);
    try {
        const popup = new Popup(wrap, POPUP_TYPE.TEXT, '', { okButton: 'Close', cancelButton: false, wide: true, large: true, allowVerticalScrolling: true });
        const shown = popup.show();
        workbench?.renderLibrary();
        workbench?.extras?.render();
        workbench?.layout?.help.refresh(panel);
        await shown;
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
    $('#sa_recap').on('click', recap);
    bindVal('#sa_keepvis', 'keepVisible', true);
    $('#sa_hide').prop('checked', s.hideArchived).on('change', function () { s.hideArchived = this.checked; saveSettingsDebounced(); });
    $('#sa_through_set').on('click', setThrough); $('#sa_ledger_import').on('click', importLedger);
    renderLedger();
    $('#sa_cond_run').on('click', () => runCondense());
    bindVal('#sa_cond_prompt', 'condensePrompt');
    $('#sa_cond_prompt_reset').on('click', () => { s.condensePrompt = DEFAULT_SETTINGS.condensePrompt; $('#sa_cond_prompt').val(s.condensePrompt); saveSettingsDebounced(); toastr.info('Condense prompt reset to the default.'); });
    refreshProfileList();
    $('#sa_side_profile, #sa_archive_profile').on('change', function () { s[this.id === 'sa_archive_profile' ? 'archiveProfile' : 'sideProfile'] = this.value; saveSettingsDebounced(); workbench?.renderFlow(); });
    $('#sa_side_test').on('click', testSide);
    $('#sa_drawer .inline-drawer-toggle').on('click', () => { refreshProfileList(); requestAnimationFrame(() => { workbench?.renderLibrary(); workbench?.layout?.help.refresh(document.querySelector('.sa-panel')); }); });
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
        workbench = new Workbench({
            settings, meta, groupSpeaker, currentAvatar, listChatFiles, checkSetup, profileState, bindProfile, memoryPeers, attachArchive: attachToChat,
            wasRenamed: (from, to) => Date.now() - (recentRenames.get(JSON.stringify([chatOwner(getContext()), chatName(from), chatName(to)])) || 0) < 60000,
            tokenizerKey: () => JSON.stringify([main_api, getContext().getCurrentModel?.(), power_user.tokenizer, oai_settings.chat_completion_source]),
            openPanel: openPanelPopup, jumpToMessage: jumpToChatMessage, context: () => ({ ...getContext(), chatId: getCurrentChatId(), characterId: this_chid }),
            saveMeta: persistMeta, saveSettings: saveSettingsDebounced,
            worldNames: lorebookNames, load: readFresh, save: saveConfirmed,
            createBook: async name => { if (!getContext().getWorldInfoNames().includes(name) && !(await createBookConfirmed(name))) throw new Error('Could not create ' + name); await updateWorldInfoList(); },
            makeEntry: (name, data) => createWorldInfoEntry(name, data), register: registerStoryBook,
            memoryBook: memoryBookName, memoryBookFor, own: storyMemoryData, options: coreOpts,
            assert: assertCurrentChat, isBusy: () => busy, isActive: () => !!settings().lorebook && !!isLorebookActive(settings().lorebook),
            begin: () => { if (busy) return false; busy = true; operationChat = getContext().chat; operationRevision = chatRevision; $('.sa-run,.sa-mem-run,.sa-cond-run').prop('disabled', true); return true; },
            end: () => { pendingUndo = null; busy = false; operationChat = null; $('.sa-run,.sa-mem-run,.sa-cond-run').prop('disabled', false); },
            confirmRecovered: async (name, actual) => { if (pendingUndo) { Journal.confirmWrite(pendingUndo.journal, name, actual); await persistMeta(); } },
            undoStart: beginUndoWrite, snapshot: saveUndoSnapshot, reload: name => { try { reloadEditor(name); } catch { /* editor closed */ } },
            model: sideCall, flowModelInfo, sendFlowRequest, buildFlowContext, readReferences, readDiaryLore, tokenCount: getTokenCountAsync, hide: hideChatMessageRange, renderLedger, prepareArchive, refreshInfo: updateInfoLine,
            archiveModel: async (req, range) => settings().archiveMode === 'chat' && !range.explicit
                ? generateQuietPrompt({ quietPrompt: req.system + '\n\n' + req.prompt, responseLength: Number(settings().maxTokens) > 0 ? Number(settings().maxTokens) : null })
                : generateRaw({ prompt: req.prompt, systemPrompt: req.system, responseLength: Number(settings().maxTokens) > 0 ? Number(settings().maxTokens) : 6000 }),
            acceptArchive: async (text, source, step) => { archiveSource = source; archiveStep = step; try { return await handleOutput(text); } finally { archiveSource = null; archiveStep = ''; } },
            afterArchive,
            ensureArchive: ensureLorebook,
            attach: async name => { assignChatLorebook(name); await saveMetadata(); $('.chat_lorebook_button').addClass('world_set'); },
            trackers: () => runTrackers(null, true),
            confirm: async (root, opts = {}) => {
                workbench?.layout?.help.observe(root);
                const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: '💾 Apply', cancelButton: 'Cancel', wide: true, large: true, allowVerticalScrolling: true, ...opts });
                addReviewHandle(root, popup.dlg);
                return (await popup.show()) === POPUP_RESULT.AFFIRMATIVE;
            },
            confirmText: async (text, opts = {}) => { const result = await callGenericPopup(esc(text), POPUP_TYPE.CONFIRM, '', opts); return result === true || result === POPUP_RESULT.AFFIRMATIVE; },
            show: (root, opts = {}) => { workbench?.layout?.help.observe(root); return new Popup(root, POPUP_TYPE.TEXT, '', { okButton: 'Close', cancelButton: false, wide: true, large: true, allowVerticalScrolling: true, ...opts }).show(); },
            notify: (message, kind = 'info') => toastr[kind](message, 'Scene Archivist'),
            offerRecap: callback => toastr.info('Welcome back. Click for a dated recap of this story.', 'Scene Archivist', { timeOut: 20000, onclick: callback }),
            download: downloadFile, rebindSettings: refreshScopedControls,
            vectorSettings: () => extension_settings.vectors, vectorHash: getStringHash, requestHeaders: getRequestHeaders,
            scanSupported: !!event_types.WORLDINFO_SCAN_DONE,
            scanLimit: () => world_info_max_recursion_steps,
            forceEntries: entries => eventSource.emit(event_types.WORLDINFO_FORCE_ACTIVATE, entries),
        });
        workbench.mount(document.querySelector('.sa-panel'));
        bindUi();
        chatControls = new ChatControls(workbench);
        workbench.chatControls = chatControls;
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
            callback: async () => { await runMemories(); return ''; },
            helpString: 'Create character memories using the source and range selected in Scene Archivist.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'archivist-recap',
            callback: async () => { await recap(); return ''; },
            helpString: 'Show a short "previously on" recap of the newest entries in the Scene Log.',
        }));
        eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
        eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        for (const event of [event_types.CHAT_COMPLETION_PROMPT_READY, event_types.GENERATE_AFTER_COMBINE_PROMPTS].filter(Boolean)) {
            eventSource.on(event, data => workbench.extras.prompt.promptReady(data));
        }
        eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
        eventSource.on(event_types.WORLDINFO_FORCE_ACTIVATE, entries => workbench.onVectorActivated(entries));
        if (event_types.WORLDINFO_SCAN_DONE) eventSource.on(event_types.WORLDINFO_SCAN_DONE, scan => workbench.onWorldInfoScan(scan));
        $('#extensionsMenu').append(`<div id="sa_wand" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-book-journal-whills extensionsMenuExtensionButton"></div><span>Summarize new messages</span></div>`);
        $('#sa_wand').on('click', () => runSummarize());
        $('#extensionsMenu').append(`<div id="sa_wand_panel" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-folder-tree extensionsMenuExtensionButton"></div><span>Scene Archivist</span></div>`);
        $('#sa_wand_panel').on('click', openPanelPopup);
        eventSource.on(event_types.CHAT_CHANGED, () => {
            chatRevision++; chatControls?.close();
            return refreshChatUi().catch(error => toastr.warning(error.message, 'Scene Archivist'));
        });
        if (event_types.CHAT_RENAMED) eventSource.on(event_types.CHAT_RENAMED, onChatRenamed);
        if (event_types.CHARACTER_RENAMED) eventSource.on(event_types.CHARACTER_RENAMED, (previous, next) => {
            const s = settings();
            (s.avatarRenames ??= {})[previous] = next;
            const bindings = s.workflowBindings;
            if (bindings?.[`card:${previous}`]) {
                bindings[`card:${next}`] = bindings[`card:${previous}`];
                delete bindings[`card:${previous}`];
            }
            saveSettingsDebounced();
        });
        for (const event of [event_types.USER_MESSAGE_RENDERED, event_types.CHARACTER_MESSAGE_RENDERED].filter(Boolean)) eventSource.on(event, mountRangeMarkers);
        let updateTimer;
        for (const event of [event_types.MESSAGE_EDITED, event_types.MESSAGE_DELETED, event_types.MESSAGE_SWIPED].filter(Boolean)) eventSource.on(event, () => {
            clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
                chatControls?.syncRange();
                mountRangeMarkers();
                if (!busy) { workbench.renderFlow(); workbench.extras.render(); }
            }, 180);
        });
        console.log(LOG, 'loaded');
    } catch (e) {
        console.error(LOG, 'failed to load', e);
    }
});

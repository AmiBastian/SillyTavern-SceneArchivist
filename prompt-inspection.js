import * as M from './memory-engine.js';
import { sharedPrefix } from './chat-workflows.js';
import { escape as html } from './workflow-tools.js';

const traceKey = 'sceneArchivistPrompt';
const maxReplies = 24;
const maxItems = 40;

export function placePromptLayers(entry) {
    if (entry.constant || M.record(entry)?.protection?.pinned) {
        Object.assign(entry, { position: 0, outletName: '', order: 8000, constant: true });
    } else {
        Object.assign(entry, { position: 4, outletName: '', depth: 1, role: 0 });
    }
}

export function toolLookup(entries, scopeReason, { topic, character, day } = {}) {
    const visible = entries.filter(entry => M.active(entry) && !entry.disable && !scopeReason(entry));
    if (Number.isInteger(day)) return visible.filter(entry => M.record(entry).type === 'unit' && M.record(entry).unit?.number === day).slice(0, 1);
    const name = String(character || '').trim().toLowerCase();
    const memories = visible.filter(entry => {
        const r = M.record(entry);
        return ['memory', 'knowledge', 'thread', 'fact'].includes(r.type)
            && (!name || [r.subject, ...(r.aliases || [])].some(alias => String(alias).toLowerCase() === name));
    });
    return M.search(memories, String(topic || '').slice(0, 200)).slice(0, 3).map(hit => hit.entry);
}

export class PromptInspection {
    constructor(workbench) {
        this.w = workbench;
        this.previousPrompt = '';
        this.lastTrace = null;
    }

    clear() {
        this.closeDock(false);
        this.current = null;
        this.lastTrace = null;
        this.previousPrompt = '';
        this.previousModel = '';
    }

    begin(type) {
        const w = this.w;
        this.current = { type, identity: w.identity(), epoch: w.generationEpoch, active: [] };
    }

    valid() {
        const w = this.w, run = this.current;
        return !!run && !w.h.isBusy() && !w.scanSuppressed && !w.vectorScan
            && run.identity === w.identity() && run.epoch === w.generationEpoch;
    }

    activated(entries) {
        if (!this.valid()) return;
        const w = this.w;
        this.current.active = [...new Map(Array.from(entries || [], entry => {
            const own = w.findRetrievedEntry(entry);
            return [M.record(own)?.id, own];
        }).filter(([id]) => id)).values()];
        this.current.seenScan = true;
    }

    promptReady(data) {
        if (data?.dryRun || !this.valid() || this.current.prefixMeasured) return;
        const text = typeof data?.prompt === 'string' ? data.prompt :
            Array.isArray(data?.chat) ? data.chat.map(message => JSON.stringify([message.role, message.name, message.content])).join('\n') : '';
        if (!text) return;
        const model = this.w.h.tokenizerKey?.() || '';
        const sample = text.slice(0, 65536);
        if (this.previousPrompt && this.previousModel === model) {
            this.current.prefixTokens = M.tokens(sharedPrefix(this.previousPrompt, sample));
        }
        this.previousPrompt = sample;
        this.previousModel = model;
        this.current.prefixMeasured = true;
    }

    receive(index, type) {
        const w = this.w, run = this.current, chat = w.h.context().chat || [];
        const message = chat[index];
        if (type === 'first_message' || !message || message.is_user || !this.valid()) return;
        this.current = null;
        const accepted = new Map((w.lastBudget?.accepted || []).map(item => [item.id, item]));
        const active = run.active.map(entry => {
            const id = M.record(entry).id, choice = accepted.get(id);
            return { id, title: M.title(entry).slice(0, 160), tokens: choice?.cost ?? M.tokens(entry.content),
                reasons: choice?.reasons || w.activationReasons(entry) };
        });
        const picked = w.sceneRecall.selection();
        const little = picked.items.map(item => ({ id: item.note.id, title: item.note.text.slice(0, 180),
            reason: item.reason, quote: !!item.quote }));
        w.sceneRecall.receive(active, index);
        const omitted = (w.lastBudget?.omitted || []).map(({ id, title, tokens, reason }) => ({ id, title: String(title).slice(0, 160), tokens, reason }));
        const trace = { at: Date.now(), active: active.slice(0, maxItems), omitted: omitted.slice(0, maxItems), little,
            littleTokens: picked.tokens, loaded: active.length + little.length, skipped: omitted.length,
            tokens: active.reduce((sum, item) => sum + item.tokens, picked.tokens), prefixTokens: run.prefixTokens, scanObserved: !!(run.seenScan || w.lastBudget || little.length),
            layered: w.options().cacheLayers };
        (message.extra ??= {})[traceKey] = trace;
        const swipe = message.swipe_info?.[message.swipe_id ?? 0];
        if (swipe) (swipe.extra ??= {})[traceKey] = trace;
        this.lastTrace = trace;
        for (const old of chat.slice(0, Math.max(0, chat.length - maxReplies))) {
            if (old.extra) delete old.extra[traceKey];
            for (const alternate of old.swipe_info || []) if (alternate?.extra) delete alternate.extra[traceKey];
        }
        this.render();
    }

    render() {
        const trace = this.lastTrace || this.w.h.context().chat?.findLast(item => item.extra?.[traceKey])?.extra?.[traceKey];
        const text = trace ? `${trace.loaded} loaded · ~${trace.tokens.toLocaleString()} tokens · ${trace.skipped} skipped.`
            : 'Send a reply with an attached archive to see its memory trail.';
        for (const status of this.w.root?.querySelectorAll('#sa-last-prompt, #sa-story-trace') || []) status.textContent = text;
    }

    closeDock(restoreFocus = true) {
        if (!this.dock) return;
        this.dock.remove();
        this.dock = null;
        document.body.classList.remove('sa-trail-open');
        if (restoreFocus && this.dockTrigger?.isConnected) this.dockTrigger.focus();
        this.dockTrigger = null;
    }

    async show(index = null, docked = false) {
        const w = this.w;
        const chat = w.h.context().chat || [], message = index === null ? null : chat[index];
        const trace = index === null
            ? this.lastTrace || chat.findLast(item => item.extra?.[traceKey])?.extra?.[traceKey]
            : message?.extra?.[traceKey];
        const root = document.createElement('div');
        root.className = 'sa-review sa-prompt-trace';
        root.innerHTML = `<h3>🔎 ${index === null ? docked ? 'Memory Trail' : 'Last reply’s memory trail' : `Memory Trail for #${index}`}</h3>
            <p class="sa-hint">What Scene Archivist selected for this reply, with the cues and sources behind it.</p>`;
        if (!trace) {
            root.insertAdjacentHTML('beforeend', '<p>No trace for this swipe. Generate a reply with an attached archive to start recording.</p>');
        } else {
            const intro = document.createElement('p');
            intro.textContent = trace.scanObserved ? `${trace.loaded} loaded · ~${trace.tokens.toLocaleString()} tokens · ${trace.skipped} skipped.` :
                'No Scene Archivist activation was reported for this reply.';
            root.append(intro);
            if (trace.prefixTokens != null) {
                const p = document.createElement('p');
                p.className = 'sa-hint';
                p.textContent = `~${trace.prefixTokens.toLocaleString()} tokens of shared prompt prefix vs. the previous request. ${trace.layered ? 'Cache-friendly delivery was on.' : 'Normal delivery was on.'}`;
                root.append(p);
            }
            for (const [title, items, total] of [['📥 Lorebook records', trace.active, trace.loaded - (trace.little?.length || 0)], ['🧹 Skipped', trace.omitted, trace.skipped]]) {
                const section = document.createElement('details');
                section.open = title.startsWith('📥');
                section.innerHTML = `<summary>${title} · ${total}</summary>`;
                if (!items.length) section.insertAdjacentHTML('beforeend', '<p>None recorded.</p>');
                for (const item of items) {
                    const row = document.createElement('div');
                    row.className = 'sa-result';
                    row.innerHTML = `<b>${html(item.title)}</b><p class="sa-hint">~${Number(item.tokens) || 0} tokens · ${html(item.reason || item.reasons?.join(', ') || 'World Info')}</p>`;
                    if (w.find(item.id)) {
                        const actions = document.createElement('div');
                        actions.className = 'sa-row sa-trail-actions';
                        const button = document.createElement('button');
                        button.type = 'button'; button.className = 'menu_button'; button.textContent = '🔎 View sources';
                        button.addEventListener('click', () => void w.showSources(item.id));
                        actions.append(button);
                        if (section.open) {
                            const load = document.createElement('button');
                            load.type = 'button'; load.className = 'menu_button'; load.textContent = '📌 Load next reply';
                            load.addEventListener('click', () => void w.dispatch('loadDetail', { dataset: { id: item.id } }).catch(error => w.h.notify(error.message, 'error')));
                            actions.append(load);
                        }
                        row.append(actions);
                    }
                    section.append(row);
                }
                root.append(section);
            }
            if (trace.little?.length) {
                const section = document.createElement('details');
                section.open = true;
                section.innerHTML = `<summary>🧵 Little Things · ${trace.little.length} · ~${trace.littleTokens} tokens</summary>`;
                for (const item of trace.little) {
                    const row = document.createElement('div');
                    row.className = 'sa-result';
                    row.innerHTML = `<b>${html(item.title)}</b><p class="sa-hint">${html(item.reason)}${item.quote ? ' · Verified quotation' : ''}</p>`;
                    const note = w.littleThings().find(note => note.id === item.id);
                    if (note) {
                        const actions = document.createElement('div');
                        actions.className = 'sa-row sa-trail-actions';
                        const controls = [
                            ['✏️ Edit cues', () => w.library.edit(note.id)],
                            ['📌 Load next reply', () => w.library.loadNext(note.id)],
                        ];
                        if (note.source?.ranges?.length) controls.unshift(['📍 Source message', () => w.library.jump(note.source, root)]);
                        else if (note.recordId && w.find(note.recordId)) controls.unshift(['🔎 Source record', () => w.showSources(note.recordId)]);
                        for (const [label, run] of controls) {
                            const button = document.createElement('button');
                            button.type = 'button'; button.className = 'menu_button'; button.textContent = label;
                            button.addEventListener('click', () => void Promise.resolve().then(run).catch(error => w.h.notify(error.message, 'warning')));
                            actions.append(button);
                        }
                        row.append(actions);
                    }
                    section.append(row);
                }
                root.querySelector('details')?.before(section);
            }
        }
        if (docked) {
            this.closeDock(false);
            const trigger = document.activeElement, origin = w.identity();
            const dialog = w.root?.closest('dialog[open]');
            const dismiss = dialog?.querySelector('.popup-button-ok');
            if (dismiss) await new Promise(resolve => {
                dialog.addEventListener('close', resolve, { once: true });
                dismiss.click();
            });
            if (origin !== w.identity()) return;
            const dock = document.createElement('aside');
            dock.className = 'sa-trail-dock';
            dock.setAttribute('aria-label', 'Memory Trail');
            const close = document.createElement('button');
            close.type = 'button'; close.className = 'menu_button sa-trail-close'; close.textContent = 'Close trail';
            close.addEventListener('click', () => this.closeDock());
            dock.addEventListener('keydown', event => { if (event.key === 'Escape') this.closeDock(); });
            dock.append(close, root); document.body.append(dock);
            document.body.classList.add('sa-trail-open');
            this.dock = dock;
            this.dockTrigger = trigger;
            close.focus({ preventScroll: true });
            return;
        }
        await w.h.show(root, { okButton: '✨ Close' });
    }
}

export function registerMemoryTools(w) {
    const context = w.h.context();
    if (typeof context.registerFunctionTool !== 'function') return;
    const available = () => w.options().memoryTools && !w.h.isBusy() && !w.scanSuppressed && w.h.isActive() && !!w.h.context().isToolCallingSupported?.();
    const lookup = async options => {
        if (!available()) return 'Scene Archivist memory tools are unavailable in this chat.';
        const origin = w.identity(), group = w.h.groupSpeaker?.();
        await w.loadBooks();
        if (origin !== w.identity() || group?.speaker !== w.h.groupSpeaker?.()?.speaker || !available()) return 'The chat or speaker changed.';
        const entries = toolLookup(w.entries, entry => w.memoryScopeReason(entry, group), options);
        return entries.map(entry => `${M.title(entry)}\n${entry.content}`.slice(0, 2400)).join('\n\n').slice(0, 4800) || 'No matching active Scene Archivist records.';
    };
    context.registerFunctionTool({
        name: 'scene_archivist_recall_memory', displayName: 'Recall a story memory',
        description: 'Look up active Scene Archivist memories for the responding character and topic.',
        parameters: { type: 'object', properties: { character: { type: 'string' }, topic: { type: 'string' } }, required: ['topic'] },
        shouldRegister: available, action: ({ topic, character }) => lookup({ topic, character }),
        formatMessage: () => 'Look up a story memory',
    });
    context.registerFunctionTool({
        name: 'scene_archivist_open_day', displayName: 'Open a saved story unit',
        description: 'Read a saved archive Day, Chapter, or other numbered story unit.',
        parameters: { type: 'object', properties: { number: { type: 'integer', minimum: 0 } }, required: ['number'] },
        shouldRegister: available,
        action: ({ number }) => Number.isInteger(number) && number >= 0 ? lookup({ day: number }) : 'Provide a non-negative story unit number.',
        formatMessage: ({ number }) => `Open story unit ${number}`,
    });
}

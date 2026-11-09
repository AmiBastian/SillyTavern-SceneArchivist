import * as M from './memory-engine.js';
import { sharedPrefix, soloMemoryReason } from './chat-workflows.js';
import { escape as html } from './workflow-tools.js';
import { addReviewHandle } from './review-window.js';
import { MemoryIndex, toolEvidence } from './memory-retrieval.js';

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

export function toolLookup(entries, scopeReason, { topic, character, day, queries } = {}, index = new MemoryIndex()) {
    const visible = entries.filter(entry => M.active(entry) && !entry.disable && !scopeReason(entry));
    if (Number.isInteger(day)) return visible.filter(entry => M.record(entry).type === 'unit' && M.record(entry).unit?.number === day).slice(0, 1).map(entry => ({ entry, parent: entry, excerpt: null }));
    const name = String(character || '').trim().toLowerCase();
    const memories = visible.filter(entry => {
        const r = M.record(entry);
        return ['memory', 'knowledge', 'thread', 'fact'].includes(r.type)
            && (!name || [r.subject, ...(r.aliases || [])].some(alias => String(alias).toLowerCase() === name));
    });
    const query = String(topic || '').trim().slice(0, 200);
    return query ? index.searchMany(memories, query, queries).slice(0, 3) : [];
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
                reasons: choice?.reasons || w.activationReasons(entry), excerpts: entry.sceneArchivistDelivery?.excerpts };
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
        this.dockResize?.disconnect();
        this.dockChanges?.disconnect();
        window.removeEventListener('resize', this.dockLayout);
        this.dockResize = this.dockChanges = this.dockLayout = null;
        this.dock.remove();
        this.dock = null;
        if (restoreFocus && this.dockTrigger?.isConnected) this.dockTrigger.focus();
        this.dockTrigger = null;
    }

    dockPlacement() {
        if (!matchMedia('(min-width: 1001px) and (pointer: fine)').matches) return { left: '', width: '' };
        const chat = document.getElementById('sheld')?.getBoundingClientRect();
        if (!chat) return null;
        const left = Math.max(12, chat.right + 12);
        const room = document.documentElement.clientWidth - left - 12;
        return room >= 300 ? { left: `${left}px`, width: `${Math.min(380, room)}px` } : null;
    }

    async show(index = null, docked = false) {
        const w = this.w;
        this.closeDock(false);
        docked = docked && (!!this.dockPosition || !!this.dockPlacement());
        const chat = w.h.context().chat || [], message = index === null ? null : chat[index];
        const trace = index === null
            ? this.lastTrace || chat.findLast(item => item.extra?.[traceKey])?.extra?.[traceKey]
            : message?.extra?.[traceKey];
        const replyIndex = index ?? (trace ? chat.findLastIndex(item => item.extra?.[traceKey] === trace) : -1);
        const title = docked ? 'Memory Trail' : index === null ? 'Last reply’s memory trail' : `Memory Trail for #${index}`;
        const header = document.createElement('header');
        header.className = 'sa-trail-head';
        header.innerHTML = `<div class="sa-trail-title"><h3><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> ${title}</h3></div>`;
        if (docked && replyIndex >= 0) header.insertAdjacentHTML('beforeend', `<p class="sa-trail-reply">Reply #${replyIndex}</p>`);
        const root = document.createElement('div');
        root.className = 'sa-review sa-prompt-trace';
        if (!docked) root.append(header);
        if (!trace) {
            root.insertAdjacentHTML('beforeend', '<p class="sa-hint">No trace for this swipe. Generate a reply with an attached archive to start recording.</p>');
        } else {
            if (trace.scanObserved) {
                const stats = document.createElement('ul');
                stats.className = 'sa-trail-stats';
                stats.setAttribute('aria-label', 'Reply totals');
                for (const stat of [`${trace.loaded} loaded`, `~${trace.tokens.toLocaleString()} tokens`, `${trace.skipped} skipped`]) {
                    const chip = document.createElement('li');
                    chip.textContent = stat;
                    stats.append(chip);
                }
                header.append(stats);
            } else {
                root.insertAdjacentHTML('beforeend', '<p class="sa-hint">No Scene Archivist activation was reported for this reply.</p>');
            }
            const littleCount = trace.little?.length || 0;
            for (const [loaded, items, total] of [[true, trace.active, trace.loaded - littleCount], [false, trace.omitted, trace.skipped]]) {
                const section = document.createElement('details');
                section.open = loaded && !littleCount;
                const summary = document.createElement('summary');
                summary.textContent = `${loaded ? '📥 Lorebook records' : '🧹 Skipped'} · ${total}`;
                section.append(summary);
                if (!items.length) section.insertAdjacentHTML('beforeend', '<p>None recorded.</p>');
                for (const item of items) {
                    const row = document.createElement('div');
                    row.className = 'sa-result';
                    row.innerHTML = `<b>${html(item.title)}</b><p class="sa-hint">~${Number(item.tokens) || 0} tokens · ${html(item.reason || item.reasons?.join(', ') || 'World Info')}</p>`;
                    if (Array.isArray(item.excerpts) && item.excerpts.length) {
                        const detail = document.createElement('p'); detail.className = 'sa-hint';
                        detail.textContent = 'Complete saved bullets supplied from lines ' + item.excerpts.map(excerpt => `${excerpt.fromLine}-${excerpt.toLine}`).join(', ') + '.';
                        row.append(detail);
                    }
                    if (w.find(item.id)) {
                        const actions = document.createElement('div');
                        actions.className = 'sa-row sa-trail-actions';
                        const button = document.createElement('button');
                        button.type = 'button'; button.className = 'menu_button'; button.textContent = '🔎 View sources';
                        button.addEventListener('click', () => void w.showSources(item.id));
                        actions.append(button);
                        if (loaded) {
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
                const summary = document.createElement('summary');
                summary.textContent = `🧵 Little Things · ${littleCount} · ~${trace.littleTokens} tokens`;
                section.append(summary);
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
            if (trace.prefixTokens != null) {
                const diagnostics = document.createElement('details');
                diagnostics.innerHTML = '<summary>Prompt delivery</summary>';
                const p = document.createElement('p');
                p.className = 'sa-hint';
                p.textContent = `~${trace.prefixTokens.toLocaleString()} tokens shared with the previous request. ${trace.layered ? 'Cache-friendly delivery was on.' : 'Normal delivery was on.'}`;
                diagnostics.append(p);
                root.append(diagnostics);
            }
        }
        if (docked) {
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
            close.type = 'button'; close.className = 'menu_button sa-trail-close'; close.textContent = 'Close';
            close.setAttribute('aria-label', 'Close trail');
            close.addEventListener('click', () => this.closeDock());
            dock.addEventListener('keydown', event => { if (event.key === 'Escape') this.closeDock(); });
            header.querySelector('.sa-trail-title').append(close);
            root.classList.add('sa-trail-body');
            dock.append(header, root); document.body.append(dock);
            this.dock = dock;
            this.dockTrigger = trigger;
            const movement = addReviewHandle(root, dock, {
                clickToMove: false,
                onMove: () => {
                    const rect = dock.getBoundingClientRect();
                    this.dockPosition = { left: rect.left, top: rect.top, width: rect.width };
                },
                onReset: () => { this.dockPosition = null; this.dockLayout(); },
            });
            movement.handle.innerHTML = '<i class="fa-solid fa-up-down-left-right" aria-hidden="true"></i> Memory Trail';
            movement.handle.setAttribute('aria-label', 'Move Memory Trail');
            header.querySelector('h3').replaceChildren(movement.handle);
            const reset = document.createElement('button');
            reset.type = 'button'; reset.className = 'menu_button sa-trail-reset';
            reset.setAttribute('aria-label', 'Reset trail position'); reset.title = 'Reset trail position';
            reset.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i>';
            reset.addEventListener('click', movement.reset);
            close.before(reset);
            this.dockLayout = () => {
                if (this.dock !== dock) return;
                const desktop = matchMedia('(min-width: 1001px) and (pointer: fine)').matches;
                movement.handle.disabled = !desktop;
                reset.hidden = !desktop;
                if (desktop && this.dockPosition) {
                    dock.style.width = `${this.dockPosition.width}px`;
                    movement.move(this.dockPosition.left, this.dockPosition.top);
                    return;
                }
                dock.classList.remove('sa-floating-review');
                dock.style.removeProperty('top');
                const placement = this.dockPlacement();
                if (!placement) {
                    this.closeDock(false);
                    void this.show(index).catch(error => w.h.notify(error.message, 'warning'));
                    return;
                }
                Object.assign(dock.style, placement);
            };
            const chatPanel = document.getElementById('sheld');
            this.dockResize = new ResizeObserver(this.dockLayout);
            this.dockChanges = new MutationObserver(this.dockLayout);
            if (chatPanel) {
                this.dockResize.observe(chatPanel);
                this.dockChanges.observe(chatPanel, { attributes: true, attributeFilter: ['style', 'class'] });
            }
            this.dockChanges.observe(document.body, { attributes: true, attributeFilter: ['class'] });
            window.addEventListener('resize', this.dockLayout);
            this.dockLayout();
            close.focus({ preventScroll: true });
            return;
        }
        await w.h.show(root, { okButton: '✨ Close', large: false });
    }
}

export function registerMemoryTools(w) {
    const context = w.h.context();
    if (typeof context.registerFunctionTool !== 'function') return;
    const index = w.memoryIndex || new MemoryIndex();
    const available = () => w.options().memoryTools && !w.h.isBusy() && !w.scanSuppressed && w.h.isActive() && !!w.h.context().isToolCallingSupported?.();
    const lookup = async options => {
        if (!available()) return 'Scene Archivist memory tools are unavailable in this chat.';
        const origin = w.identity(), group = w.h.groupSpeaker?.(), epoch = w.generationEpoch;
        const before = w.h.context(), soloAvatar = group ? null : before.characters?.[before.characterId]?.avatar;
        await w.loadBooks();
        const current = w.h.context(), currentGroup = w.h.groupSpeaker?.();
        if (origin !== w.identity() || !!group !== !!currentGroup || group?.speaker !== currentGroup?.speaker
            || !group && soloAvatar !== current.characters?.[current.characterId]?.avatar
            || epoch !== w.generationEpoch || !available()) return 'The chat or speaker changed.';
        const rows = toolLookup(w.entries, entry => w.memoryScopeReason(entry, group) || w.sceneRecall?.reason(entry)
            || !group && soloMemoryReason(M.record(entry), current, w.h.currentAvatar), options, index);
        return toolEvidence(rows);
    };
    context.registerFunctionTool({
        name: 'scene_archivist_recall_memory', displayName: 'Recall a story memory',
        description: 'Look up active Scene Archivist memories for the responding character and topic. In solo chats, personal memories and knowledge belong to the responding card only. For an indirect callback, supply up to three alternate search queries using related wording; these are search hints, not facts. This tool reads saved memories, not raw private scenes.',
        parameters: { type: 'object', properties: { character: { type: 'string' }, topic: { type: 'string' },
            queries: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 200 }, description: 'Optional alternate wording for the same topic. Do not guess an answer.' } }, required: ['topic'] },
        shouldRegister: available, action: ({ topic, character, queries }) => lookup({ topic, character, queries }),
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

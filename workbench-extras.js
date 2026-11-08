import * as Core from './core.js';
import * as M from './memory-engine.js';
import * as Flow from './flow.js';
import { anchorIndex, isSkipped } from './chat-workflows.js';
import { PromptInspection, registerMemoryTools } from './prompt-inspection.js';

const el = (tag, text = '', className = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
};
const button = (label, run) => {
    const node = el('button', label, 'menu_button');
    node.type = 'button';
    node.addEventListener('click', run);
    return node;
};
const form = (title, note) => {
    const root = el('div', '', 'sa-review');
    root.append(el('h3', title));
    if (note) root.append(el('p', note, 'sa-hint'));
    return root;
};
const field = (root, title, control) => {
    control.classList.add('text_pole');
    const label = el('label', title, 'sa-field');
    label.append(control); root.append(label);
    return control;
};
const labels = {
    'catch-up': 'Archive thoroughly', archive: 'Summarize', memories: 'Character memories',
    'tracker-pass': 'Trackers', 'memory-audit': 'Organize memories', diary: 'Diary', condense: 'Condense',
};
export const jobLabel = kind => labels[kind] || String(kind || 'Story job').replaceAll('-', ' ');

export class WorkbenchExtras {
    constructor(workbench) {
        this.w = workbench;
        this.prompt = new PromptInspection(workbench);
        registerMemoryTools(workbench);
    }

    render() {
        const w = this.w, root = w.root;
        const stats = root?.querySelector('#sa-story-stats');
        if (!stats) return;
        const chat = w.h.context().chat || [];
        const pending = Flow.uncoveredArchiveMessages(chat, w.h.meta()).length;
        const total = Core.pendingMessages(chat).filter(message => !isSkipped(w.h.meta().rangeControl, chat[message.idx])).length;
        const archive = w.h.settings().lorebook, job = w.state().job;
        root.querySelector('#sa-story-name').textContent = archive || 'Start with one scene';
        stats.replaceChildren(el('p', archive ? `${total - pending} of ${total} messages archived · ${pending} waiting` : 'Pick or create an archive to get started.', 'sa-hint'));
        const progress = el('progress');
        progress.setAttribute('aria-label', 'Archive coverage'); progress.max = Math.max(total, 1); progress.value = Math.max(total - pending, 0);
        stats.append(progress);
        const summary = root.querySelector('#sa-story-job');
        summary.textContent = job ? `🧾 ${jobLabel(job.kind)} · ${job.status === 'done' ? 'Saved' : job.status === 'canceled' ? 'Discarded' : job.status === 'failed' ? 'Needs attention' : job.status}` : '🧾 No jobs for this story yet.';
        const recent = root.querySelector('#sa-story-recent');
        const rows = (w.h.meta().journals || []).filter(item => item.archive === archive && ['saved', 'undone'].includes(item.status)).slice(-3).reverse();
        recent.replaceChildren(...(rows.length ? rows.map(item => el('li', `${jobLabel(item.label || 'Story changes')} · ${item.status === 'undone' ? 'Undone' : 'Saved'}`)) : [el('li', 'Your next saved scene will appear here.')]));
        const warnings = root.querySelector('#sa-story-warnings');
        warnings.textContent = archive && !w.h.isActive() ? '⚠️ Attach your archive to use it in replies.' :
            job?.error ? `⚠️ ${job.error}` : w.state().branchLineage?.parent ? `🌿 Branched from ${w.state().branchLineage.parent}` : '';
        root.querySelector('[data-sa-action=storyAttach]').hidden = !archive || w.h.isActive();
        const scope = root.querySelector('#sa-profile-scope');
        if (scope) scope.textContent = w.h.profileState?.().label || '🌐 Global workflow';
        this.prompt.render();
    }

    renderChip(job) {
        const w = this.w;
        if (!this.chip) {
            this.chip = button('', () => {
                if (!w.root.dataset.popped) void w.h.openPanel?.();
                requestAnimationFrame(() => w.root.querySelector('#sa-jobs .sa-job')?.scrollIntoView({ block: 'nearest' }));
            });
            this.chip.classList.add('sa-job-chip');
            document.body.append(this.chip);
        }
        this.chip.hidden = !job || ['done', 'canceled'].includes(job.status);
        if (!this.chip.hidden) {
            const status = job.phase === 'review' ? 'Ready for review' : job.status === 'failed' ? 'Retry available' : job.status === 'paused' ? 'Paused' : 'Working';
            this.chip.textContent = `${jobLabel(job.kind)} · ${status} · ${job.cursor}/${job.steps.length}`;
        }
    }

    async remember(index, selected = '') {
        const w = this.w, chat = w.h.context().chat, message = chat[index], origin = w.identity();
        if (!message) throw new Error('That message is no longer available.');
        const anchor = w.chatControls.anchor(index), hash = M.messageHash(message);
        const root = form(`🧠 Remember this · #${index}`, 'Save a memory or keep a small detail with this message as its source.');
        const type = field(root, 'Save as', el('select'));
        type.add(new Option('Character memory', 'memory'));
        type.add(new Option('Little Thing', 'little'));
        const group = w.h.groupSpeaker?.(), context = w.h.context();
        const cards = group?.members || (context.characters || []).filter(card => card.name).map(card => ({ name: card.name, avatar: card.avatar }));
        const select = field(root, 'Who remembers it?', el('select'));
        select.add(new Option('✏️ Enter a character or NPC name', ''));
        for (const card of cards) select.add(new Option(card.name + (cards.filter(c => c.name === card.name).length > 1 ? ` · ${card.avatar}` : ''), card.avatar));
        const who = field(root, 'Name for an NPC or persona (blank for a shared Little Thing)', el('input'));
        const sameName = cards.filter(card => card.name === message.name && !message.is_user);
        const guess = message.original_avatar || (sameName.length === 1 ? sameName[0].avatar : '');
        if (guess && [...select.options].some(option => option.value === guess)) select.value = guess;
        who.value = message.name || '';
        const draft = field(root, 'Memory', el('textarea'));
        draft.rows = 5;
        draft.value = selected || String(message.mes || '').trim().slice(0, 1000);
        const keywords = field(root, 'Keywords, separated by commas', el('input'));
        keywords.placeholder = 'brass key, west gate';
        const tidy = button('✨ Polish wording with AI', async () => {
            tidy.disabled = true;
            try {
                if (!draft.value.trim()) return;
                draft.value = (await w.call({ system: 'Rewrite this one memory more concisely. Preserve all facts and quotes. Return only the revised text.', prompt: draft.value, maxTokens: 500 }, 'Polish one memory')).trim();
            } catch (error) { w.h.notify(error.message, 'error'); } finally { tidy.disabled = false; }
        });
        root.append(tidy);
        if (!(await w.h.confirm(root, { okButton: '💾 Save detail' }))) return;
        const card = cards.find(item => item.avatar === select.value);
        const subject = card?.name || who.value.trim(), body = draft.value.trim();
        if (!body || (type.value === 'memory' && !subject)) throw new Error('Give the detail some text and assign a character for a character memory.');
        const current = () => {
            const at = anchorIndex(w.h.context().chat, anchor);
            if (w.identity() !== origin || w.h.context().chat !== chat || at === null || M.messageHash(chat[at]) !== hash) {
                throw new Error('The source message changed. Open Remember this from the current message again.');
            }
            return at;
        };
        current();
        if (type.value === 'little') return w.library.save({
            text: body, knows: subject ? [subject] : [], knownAvatar: card?.avatar, cues: keywords.value, date: M.chronology(message.mes).dates[0],
            quote: selected && selected.length <= 180 && String(message.mes).includes(selected) ? selected : '',
        }, { source: () => { const at = current(); return w.source([{ from: at, to: at }]); } });
        if (!w.flowSettings().persona && !card && subject.toLowerCase() === String(context.name1).toLowerCase()) throw new Error('Enable persona memories in Settings before saving a memory for your persona.');
        if (!(await w.h.ensureArchive())) return;
        await w.withLock(async () => {
            await w.loadBooks();
            const at = current();
            const books = M.copy(w.books), bases = w.bases(), keys = M.unique(keywords.value.split(',').map(key => key.trim()));
            const content = Core.memoryDocText(subject, [{ text: body.replace(/\s*\n\s*/g, ' '), a: null, date: '' }], {}, w.h.settings().unit);
            const entry = w.add(books, 'memory', content, { subject, subjectAvatar: card?.avatar, source: w.source([{ from: at, to: at }]),
                manualClip: true, body, aliases: [], keywords: keys }, !keys.length);
            entry.key = keys.length ? keys : [subject];
            entry.comment = `🧠| Memory clip · ${subject}`;
            await w.write(books, bases, 'Remember one message');
        });
        await w.render();
        w.h.notify(`Saved a memory for ${subject}.`, 'success');
    }

    async suggestBreaks() {
        const w = this.w, chat = w.h.context().chat || [], origin = w.identity();
        const from = w.value('rangeFrom'), to = w.value('rangeTo');
        const hold = Math.max(0, Number(w.value('rangeHold')) || 0);
        const pending = Flow.uncoveredArchiveMessages(chat, w.h.meta()).filter(message => message.idx < chat.length - hold);
        const messages = from !== '' && to !== '' ? w.previewRange().messages : pending;
        if (messages.length < 2) throw new Error('Select at least two eligible messages to look for scene breaks.');
        const ids = new Map(messages.slice(0, -1).map(message => [message.idx, { message: chat[message.idx], hash: M.messageHash(chat[message.idx]) }]));
        const raw = await w.withLock(() => w.call({
            system: 'Suggest up to six safe places to END a story scene. Prefer a complete action, change in time or location, or a closing beat. Return JSON only with {"breaks":[{"after":0,"reason":"brief explanation"}]}. Use actual supplied message numbers. Return an empty array when no break is clear.',
            prompt: Core.buildTranscript(messages), maxTokens: 1200,
        }, 'Suggest scene breaks'));
        if (w.identity() !== origin || chat !== w.h.context().chat) return;
        const breaks = M.parseJSON(raw)?.breaks;
        if (!Array.isArray(breaks)) throw new Error('The model did not return scene break suggestions.');
        const choices = [...new Map(breaks.filter(item => Number.isInteger(item?.after) && ids.has(item.after)).map(item => [item.after, item])).values()].slice(0, 6);
        const root = form('💡 Possible scene breaks', 'A good scene ending can save you from summarizing the cliffhanger before it lands.');
        if (!choices.length) root.append(el('p', 'No clear scene break was found in these messages.'));
        for (const choice of choices) {
            const row = el('div', '', 'sa-result');
            row.append(el('b', `After #${choice.after}`), el('p', String(choice.reason || '').slice(0, 300)),
                button('🏁 Use this as range end', async () => {
                    const source = ids.get(choice.after), at = chat.indexOf(source.message);
                    if (w.identity() !== origin || at < 0 || M.messageHash(chat[at]) !== source.hash) {
                        w.h.notify('This message changed. Ask for new suggestions.', 'warning'); return;
                    }
                    await w.chatControls.pick('to', at, false);
                    root.closest('dialog')?.querySelector('.popup-button-ok')?.click();
                }));
            root.append(row);
        }
        await w.h.show(root);
    }

    async setup() {
        const w = this.w, root = form('🔧 Check setup', 'A quick look at how this story is connected to SillyTavern.');
        const checks = await w.h.checkSetup?.() || [];
        const s = w.h.settings(), ctx = w.h.context();
        for (const [label, profile] of [['Archive', s.archiveProfile], ['Memories and trackers', s.sideProfile]]) {
            try { checks.push({ level: 'ok', text: `${label} model route · ${w.h.flowModelInfo(profile || '').name}` }); }
            catch (error) { checks.push({ level: 'bad', text: `${label} · ${error.message}` }); }
        }
        checks.push({ level: w.options().budget > 0 ? 'ok' : 'warn', text: `Scene Archivist memory budget · ${Number(w.options().budget).toLocaleString()} tokens.` });
        if (w.h.scanSupported === false) checks.push({ level: 'warn', text: 'This SillyTavern version does not expose the World Info budget hook.' });
        if (w.h.vectorSettings?.()?.enabled_world_info && typeof globalThis.vectors_rearrangeChat !== 'function') {
            checks.push({ level: 'warn', text: 'World Info vector search is on, but the vector extension did not expose its search hook.' });
        }
        if (w.books[s.lorebook]?.sceneArchivistStory?.shared) checks.push({ level: 'ok', text: 'This archive is intentionally shared. Each chat keeps separate source coverage.' });
        const overlaps = (w.h.memoryPeers?.() || []).join(', ');
        if (overlaps) checks.push({ level: 'warn', text: `Possible overlapping memory tools · ${overlaps}. Check which summaries each tool sends before enabling both on this chat.` });
        if (w.options().memoryTools) checks.push({ level: ctx.isToolCallingSupported?.() ? 'ok' : 'warn',
            text: ctx.isToolCallingSupported?.() ? 'The active connection supports on-demand memory tools.' : 'On-demand memory tools need a tool-capable Chat Completion connection and Function Calling enabled.' });
        const list = el('ul', '', 'sa-health-list');
        for (const check of checks) list.append(el('li', `${{ ok: '🟢', warn: '🟡', bad: '🔴' }[check.level] || 'ℹ️'} ${check.text}`));
        root.append(list);
        for (const [label, profile] of [['Archive', s.archiveProfile], ['Memory', s.sideProfile]]) {
            const test = button(`🔌 Test ${label.toLowerCase()} model · 1 request`, async () => {
                test.disabled = true;
                try {
                    const response = await w.h.sendFlowRequest({ system: 'Reply with the single word ready.', prompt: 'Connection test.', maxTokens: 20 }, profile || '');
                    list.append(el('li', response?.trim() ? `🟢 ${label} model replied.` : `🟡 ${label} model returned no text.`));
                } catch (error) { list.append(el('li', `🔴 ${label} model · ${error.message}`)); }
                finally { test.disabled = false; }
            });
            root.append(test);
        }
        await w.h.show(root);
    }

    async profiles() {
        const w = this.w, state = w.h.profileState?.();
        if (!state) return;
        const origin = w.identity();
        const root = form('🎛️ Workflow profiles', state.label + '. A chat profile takes precedence over its character or group. Editing a bound profile updates all chats that use it.');
        const select = field(root, 'Workflow to use', el('select'));
        select.add(new Option('Use the next scope down', ''));
        for (const profile of state.profiles) select.add(new Option(profile.name, profile.id));
        const name = field(root, 'New profile from these settings', el('input'));
        name.placeholder = 'Long-context stories';
        const scope = field(root, 'Apply to', el('select'));
        scope.add(new Option('This chat', 'chat'));
        if (state.owner) scope.add(new Option(state.group ? 'This group' : 'This character', 'owner'));
        if (state.chat || state.ownerBinding) select.value = state.chat || state.ownerBinding;
        if (!(await w.h.confirm(root, { okButton: '💾 Apply profile' })) || origin !== w.identity()) return;
        await w.h.bindProfile?.(scope.value, select.value, name.value.trim());
        w.syncOptions(); w.h.rebindSettings(); w.renderFlow(); this.render();
    }

    async timeline(exportOnly = false) {
        const w = this.w;
        await w.loadBooks();
        const entries = w.entries.filter(entry => M.record(entry)?.type === 'memory' && M.active(entry));
        const subjects = M.unique(entries.map(entry => M.record(entry).subject || Core.classifyEntry(entry)?.name));
        if (!subjects.length) throw new Error('Create or save a character memory first.');
        const root = form(exportOnly ? '📄 Export character memories' : '🗓️ Character timeline', 'Choose a character to browse their dated memories and the source messages.');
        const select = field(root, 'Character', el('select'));
        for (const subject of subjects) select.add(new Option(subject, subject));
        const selected = w.value('memorySubject');
        if (subjects.includes(selected)) select.value = selected;
        const own = () => entries.filter(entry => (M.record(entry).subject || Core.classifyEntry(entry)?.name) === select.value);
        if (exportOnly) {
            if (await w.h.confirm(root, { okButton: '📥 Download Markdown' })) {
                const name = select.value.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 48) || 'Character';
                w.h.download(`${name}-memories.md`, own().map(entry => entry.content).join('\n\n'), 'text/markdown');
            }
            return;
        }
        const rows = el('div', '', 'sa-timeline');
        const draw = () => {
            const items = own().flatMap(entry => {
                const record = M.record(entry), parsed = Core.parseMemoryDoc(entry.content);
                return (parsed.length ? parsed : [{ text: entry.content, date: record.dates?.[0] }])
                    .map(item => ({ ...item, record }));
            });
            const dateOrder = date => Number.isNaN(Date.parse(date)) ? Number.MAX_SAFE_INTEGER : Date.parse(date);
            items.sort((a, b) => dateOrder(a.date) - dateOrder(b.date) || (a.a ?? Infinity) - (b.a ?? Infinity));
            rows.replaceChildren();
            if (w.state().branchLineage?.parent) rows.append(el('p', `🌿 Branched from ${w.state().branchLineage.parent}`, 'sa-hint'));
            for (const item of items.slice(0, 200)) {
                const row = el('article', '', 'sa-result');
                row.append(el('b', item.date || (item.a != null ? `${w.h.settings().unit} ${item.a}` : 'Undated')), el('p', item.text));
                row.append(button('🔎 View source evidence', () => void w.showSources(item.record.id)));
                rows.append(row);
            }
            if (items.length > 200) rows.append(el('p', 'Showing the first 200 memories. Export Markdown for the complete list.', 'sa-hint'));
        };
        root.append(rows); select.addEventListener('change', draw); draw();
        await w.h.show(root);
    }

    async pin(id) {
        const w = this.w;
        await w.withLock(async () => {
            await w.loadBooks();
            const books = M.copy(w.books), { entry } = w.entryIn(books, id), record = M.record(entry);
            if (record.type !== 'thread' || !M.active(entry)) throw new Error('Choose an open story thread to pin.');
            const pinned = !record.protection?.pinned;
            M.revise(entry, entry.content, pinned ? 'Pinned story thread' : 'Unpinned story thread', {
                protection: { ...record.protection, pinned }, beforePinConstant: pinned ? !!entry.constant : undefined,
            });
            entry.constant = pinned ? true : !!record.revisions.at(-1).metadata.beforePinConstant;
            await w.write(books, w.bases(), pinned ? 'Pin story thread' : 'Unpin story thread');
        });
        await w.render();
    }

    async importLore() {
        const w = this.w, origin = w.identity(), s = w.h.settings();
        const root = form('📥 Copy from a lorebook', 'Copy one selected entry into this story as a searchable clip. You can review the wording and keywords first. The original book stays available.');
        const select = field(root, 'External lorebook', el('select'));
        const entrySelect = field(root, 'Entry', el('select'));
        const text = field(root, 'Clip text', el('textarea'));
        text.rows = 9;
        const keys = field(root, 'Keywords, separated by commas', el('input'));
        for (const name of w.h.worldNames().filter(name => name !== s.lorebook && !s.storyBooks?.[s.lorebook]?.[name])) select.add(new Option(name, name));
        if (!select.options.length) throw new Error('No external lorebooks are available.');
        let loaded = [];
        const update = () => {
            const entry = loaded[Number(entrySelect.value)];
            text.value = entry?.content || '';
            keys.value = (entry?.key || []).join(', ');
        };
        const load = async () => {
            const name = select.value, data = await w.h.load(name);
            if (name !== select.value) return;
            loaded = Object.values(data?.entries || {}).filter(entry => entry.content && !M.record(entry));
            entrySelect.replaceChildren(...loaded.map((entry, index) => new Option(entry.comment || String(entry.content).slice(0, 80), String(index))));
            update();
        };
        select.addEventListener('change', () => void load().catch(error => w.h.notify(error.message, 'error')));
        entrySelect.addEventListener('change', update);
        await load();
        if (!(await w.h.confirm(root, { okButton: '💾 Save copied clip' })) || origin !== w.identity()) return;
        const body = text.value.trim(), source = loaded[Number(entrySelect.value)];
        if (!body || !source) throw new Error('Choose a lorebook entry with text.');
        if (!(await w.h.ensureArchive()) || origin !== w.identity()) return;
        await w.withLock(async () => {
            await w.loadBooks();
            const books = M.copy(w.books), bases = w.bases();
            const clip = w.add(books, 'clip', `## ► Clip · ${source.comment || select.value}\n\n${body}`, {
                body, importedFrom: { book: select.value, uid: source.uid, comment: source.comment || '' },
            });
            clip.key = M.unique(keys.value.split(',').map(key => key.trim()));
            clip.disable = !clip.key.length;
            await w.write(books, bases, 'Copy external lorebook entry');
        });
        await w.render();
    }

    async estimate(steps, flow, confirm = false) {
        const w = this.w, root = form('📊 Estimate this run', 'A preview of the planned requests using the sources available now. Model replies, newly generated summaries and optional SillyTavern context affect the final size.');
        let input = 0, output = 0, count = 0;
        const lines = el('ul');
        for (const payload of steps) {
            const stage = payload.kind === 'tracker-pass' ? 'trackers' : payload.kind;
            const info = w.h.flowModelInfo(flow.profiles[stage]);
            const plan = await w.performFlow({ options: { flow } }, { payload }, true);
            if (!plan) continue;
            const text = plan.req.system + '\n' + plan.req.prompt;
            const estimate = Number(await w.h.tokenCount?.(text)) || M.tokens(text);
            const reserve = info.output || (stage === 'trackers' ? 4000 : 6000);
            input += estimate; output += reserve; count++;
            lines.append(el('li', `${jobLabel(payload.kind)} · ${info.name} · ~${estimate.toLocaleString()} input tokens${info.context && estimate + reserve > info.context ? ' · ⚠️ exceeds this context budget' : ''}`));
            if (flow.auditMemories && payload.kind === 'memories') {
                const auditInput = estimate + reserve;
                input += auditInput; output += 1800; count++;
                lines.append(el('li', `Evidence audit · ~${auditInput.toLocaleString()} input tokens including an estimated memory response · 1 additional request.`));
            }
        }
        if (flow.referenceReport) {
            const report = flow.referenceReport;
            root.append(el('p', `Reference lore: ${report.selected.length} complete entries selected, ${report.omitted.length} omitted · ~${report.tokens.toLocaleString()} tokens from ~${report.total.toLocaleString()} selected initially.`));
            const books = new Map();
            for (const item of report.selected) books.set(item.book, (books.get(item.book) || 0) + item.tokens);
            for (const [book, tokens] of books) lines.append(el('li', `Reference book ${book} · ~${tokens.toLocaleString()} tokens.`));
        }
        root.append(el('p', 'Estimates include enabled audits. Malformed replies can add a bounded retry; input can change after earlier stages generate new material.', 'sa-hint'));
        root.append(el('p', `${flow.singleRequest && count > 1 ? '1 combined request' : `${count} planned ${count === 1 ? 'request' : 'requests'}`} · ~${input.toLocaleString()} input tokens.`), lines);
        const inputPrice = field(root, 'Input price per million tokens, optional', el('input'));
        const outputPrice = field(root, 'Output price per million tokens, optional', el('input'));
        const total = el('p', 'Enter rates from your provider to estimate cost.', 'sa-hint');
        for (const box of [inputPrice, outputPrice]) {
            box.type = 'number'; box.min = '0'; box.step = 'any';
            box.addEventListener('input', () => {
                const price = (input * Math.max(0, Number(inputPrice.value)) + output * Math.max(0, Number(outputPrice.value))) / 1e6;
                total.textContent = `~${price.toFixed(4)} in the currency you entered, including the configured output allowance.`;
            });
        }
        root.append(total);
        if (confirm) return w.h.confirm(root, { okButton: '▶️ Start run', cancelButton: 'Back' });
        await w.h.show(root);
    }

    async dispatch(action, node) {
        const w = this.w;
        switch (action) {
            case 'storyThorough': await w.archiveWorkflow(true); break;
            case 'storyRange': w.layout.jump('archive-range'); break;
            case 'storyAttach': await w.h.attachArchive?.(); this.render(); break;
            case 'sharedFiling':
                w.layout.jump('settings-sharing');
                w.root.querySelector('#sa-shared-filing').open = true;
                break;
            case 'rangeClear': await w.chatControls.clear(); break;
            case 'sceneBreaks': await this.suggestBreaks(); break;
            case 'estimateThorough': await w.startFlow('catch-up', null, null, true); break;
            case 'estimateRange': await w.startFlow('catch-up', w.previewRange(), null, true); break;
            case 'estimateMemories': await w.startFlow('memories', null, null, true); break;
            case 'showPromptTrace': await this.prompt.show(); break;
            case 'dockPromptTrace': await this.prompt.show(null, true); break;
            case 'setupHealth': await this.setup(); break;
            case 'profiles': await this.profiles(); break;
            case 'characterTimeline': await this.timeline(); break;
            case 'characterExport': await this.timeline(true); break;
            case 'pinThread': await this.pin(node.dataset.id); break;
            case 'importLore': await this.importLore(); break;
            default: return false;
        }
        return true;
    }
}

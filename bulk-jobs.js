// A bulk run has a private draft of its books. Only the final approved draft
// reaches the host. Drafts and completed steps live in the durable job itself.
import * as M from './memory-engine.js';
import * as Core from './core.js';
import { approvedChanges, entrySettings } from './workflow-tools.js';
import { same } from './entry-journal.js';
import { recordSources } from './recovery-tools.js';
import { addLittleThings, littleThings, reviewLittleThing, setLittleThings } from './little-things.js';

function storySettings(book, storyId) {
    const settings = { schema: 1, id: storyId, shared: false, ...book?.sceneArchivistStory };
    delete settings.littleThings;
    return settings;
}

function mergeNotes(original, current, draft) {
    const [base, live, pending] = [original, current, draft].map(book => new Map(littleThings(book).map(note => [note.id, note])));
    const notes = [];
    for (const id of new Set([...live.keys(), ...pending.keys(), ...base.keys()])) {
        const before = base.get(id), saved = live.get(id), proposed = pending.get(id);
        if (!same(before, saved) && !same(before, proposed) && !same(saved, proposed)) return null;
        const note = same(before, proposed) ? saved : proposed;
        if (note) notes.push(M.copy(note));
    }
    return notes;
}

export class BulkRun {
    constructor(workbench, job) {
        this.w = workbench; this.job = job; this.real = workbench.baseHost;
    }
    async initialize() {
        if (!this.job.draft) {
            await this.w.loadBooks();
            const meta = this.real.meta();
            const state = { ...this.w.liveState(), job: undefined };
            this.job.draft = {
                books: M.copy(this.w.books), before: M.copy(this.w.books),
                meta: M.copy({ ...meta, undo: undefined, journals: undefined, workbench: state }),
                settings: M.copy(this.real.settings()), notices: [], archiveRanges: [],
                approved: false, undoStarted: false,
            };
            await this.real.saveMeta();
        }
        this.data = this.job.draft;
        this.data.meta.workbench.telemetry = this.w.liveState().telemetry;
        // Limits may be raised before retrying a retained job. Story prompts,
        // destinations and the queued selection remain the original snapshot.
        const live = this.real.settings().workbench;
        if (Number.isFinite(live?.requestBudget)) {
            const options = (this.data.settings.workbench ??= {});
            options.requestBudget = live.requestBudget;
            if (live.modelAwareRequests) options.modelAwareRequests = true;
        }
        // Never serialize a job inside its own draft.
        Object.defineProperty(this.data.meta.workbench, 'job', { value: this.job, configurable: true, writable: true, enumerable: false });
        const d = this.data, real = this.real;
        this.host = {
            ...real,
            settings: () => d.settings, meta: () => d.meta,
            context: () => ({ ...real.context(), getWorldInfoNames: () => M.unique([...real.context().getWorldInfoNames(), ...Object.keys(d.books)]) }),
            load: async name => {
                if (!(name in d.books)) {
                    const original = await real.load(name);
                    d.before[name] = M.copy(original || { entries: {} });
                    d.books[name] = M.copy(original || { entries: {} });
                }
                return M.copy(d.books[name]);
            },
            save: async (name, data) => { d.books[name] = M.copy(data); },
            createBook: async name => { d.books[name] ??= { entries: {} }; d.before[name] ??= { entries: {} }; },
            register: (archive, name, kind) => { ((d.settings.storyBooks ??= {})[archive] ??= {})[name] = kind; },
            saveSettings: () => {}, undoStart: () => {}, snapshot: async () => {}, reload: () => {}, refreshInfo: async () => {},
            confirmText: async text => { if (!d.notices.includes(text)) d.notices.push(text); return true; },
            afterArchive: async (range, days, hide) => {
                if (!d.archiveRanges.some(r => r.range.stepId === range.stepId)) d.archiveRanges.push({ range, days, hide });
            },
            notify: () => {},
        };
    }
    async run(fn) {
        await this.initialize();
        const w = this.w, previous = w.h;
        w.bulkRun = this; w.h = this.host;
        try { return await fn(); }
        finally { w.h = previous; w.bulkRun = null; }
    }
    async acceptArchive(text, source, stepId, placement = null) {
        const w = this.w, d = this.data, name = d.settings.lorebook;
        const data = M.copy(d.books[name] || { entries: {} }), before = M.copy(data);
        const { parsed, plan, littleThings: proposed } = await this.real.prepareArchive(text, data, source, placement);
        if (!plan.adds.some(a => a.include && a.content.trim()) && !plan.states.some(a => a.include && a.content.trim())) {
            throw new Error('This archive pass proposed no new entries or state changes. Its range remains pending.');
        }
        Core.applyPlan(data, plan, parsed, this.real.options(), book => this.real.makeEntry(name, book));
        const changed = M.captureChanges(data, before, Core.classifyEntry, { storyId: w.state().storyId, source, reason: 'Archive write' });
        for (const e of Object.values(data.entries)) if (M.record(e)?.storyId === w.state().storyId) e.sceneArchivistArchive = name;
        if (!this.job.options.automatic && proposed?.length) addLittleThings(data, w.archiveLittleThings(proposed, source), w.state().storyId);

        data.sceneArchivistReceipts = M.unique([...(data.sceneArchivistReceipts || []), stepId]);
        d.books[name] = data;
        d.meta.lastDay = Core.managedSummary(data).lastDay;
        d.meta.at = Date.now(); d.meta.messages = this.real.context().chat?.length ?? 0;
        for (const warning of plan.warnings || []) if (!d.notices.includes(warning)) d.notices.push(warning);
        return { ids: changed.filter(id => Object.values(data.entries).some(e => M.record(e)?.id === id && M.record(e).type === 'unit')), days: plan.adds.filter(a => a.include).map(a => a.dayNum).filter(Number.isInteger) };
    }
    changes() {
        const result = [];
        for (const [book, data] of Object.entries(this.data.books)) {
            for (const e of Object.values(data.entries || {})) {
                const before = this.data.before[book]?.entries?.[e.uid];
                if (same(before, e)) continue;
                result.push({ title: `${M.title(e)} · ${book}`, before: before?.content || '', content: e.content, book, uid: e.uid,
                    settingsBefore: entrySettings(before), settingsAfter: entrySettings(e) });
            }
            const saved = new Set(littleThings(this.data.before[book]).map(note => note.id));
            for (const note of littleThings(data)) if (!saved.has(note.id)) result.push(reviewLittleThing(note, book));
        }
        return result;
    }
    async validate() {
        const d = this.data;
        this.real.assert();
        if (this.real.settings().lorebook !== this.job.options.archive) throw new Error('Select this job’s original archive before resuming it.');
        for (const [name, original] of Object.entries(d.before)) {
            const current = await this.real.load(name);
            const written = current?.sceneArchivistReceipts?.includes(this.job.id);
            const expected = written ? d.books[name] : original;
            if (M.bookHash(current) === M.bookHash(expected)) continue;
            const storyId = d.meta.workbench.storyId;
            if (!written && current && same(storySettings(current, storyId), storySettings(original, storyId))) {
                const draft = d.books[name];
                const notes = mergeNotes(original, current, draft);
                const keys = new Set([...Object.keys(original.entries || {}), ...Object.keys(current.entries || {}), ...Object.keys(draft.entries || {})]);
                const conflicts = [...keys].filter(key => !same(original.entries[key], current.entries[key]) &&
                    !same(original.entries[key], draft.entries[key]) && !same(current.entries[key], draft.entries[key]));
                if (!conflicts.length && notes) {
                    for (const key of keys) if (same(original.entries[key], draft.entries[key])) {
                        if (current.entries[key]) draft.entries[key] = M.copy(current.entries[key]);
                        else delete draft.entries[key];
                    }
                    draft.sceneArchivistReceipts = M.unique([...(draft.sceneArchivistReceipts || []), ...(current.sceneArchivistReceipts || [])]);
                    setLittleThings(draft, notes, storyId);
                    d.before[name] = M.copy(current);
                    continue;
                }
            }
            throw new Error(`"${name}" changed while this bulk run was waiting. Cancel this job and choose the corrected sources; no further books were written.`);
        }
        this.real.assert();
    }
    async saveApproval() {
        const job = this.job, d = this.data, approval = job.approval;
        this.real.undoStart();
        const archive = this.real.settings().lorebook;
        const ordered = [...Object.entries(approval.books).filter(([name]) => name !== archive), ...Object.entries(approval.books).filter(([name]) => name === archive)];
        for (const [name, target] of ordered) {
            if (!this.real.context().getWorldInfoNames().includes(name)) await this.real.createBook(name);
            const current = await this.real.load(name);
            const applied = current.sceneArchivistReceipts?.includes(approval.id);
            if (applied) {
                if (M.bookHash(current) !== M.bookHash(target)) throw new Error(`"${name}" changed after this partial approval. Its confirmed changes were kept; inspect the conflict before continuing.`);
                await this.real.confirmRecovered?.(name, current); continue;
            }
            if (M.bookHash(current) !== approval.bases[name]) throw new Error(`"${name}" changed before this approval was saved. Refresh and review the conflict.`);
            await this.real.snapshot(name, current);
            target.sceneArchivistReceipts = M.unique([...(target.sceneArchivistReceipts || []), approval.id]);
            await this.real.saveMeta(); // Persist the exact save intent before the request.
            await this.real.save(name, target); this.real.reload(name); await this.real.saveMeta();
        }
        for (const [name] of Object.entries(approval.books)) {
            const saved = await this.real.load(name); d.before[name] = M.copy(saved);
            if (saved.sceneArchivistStory) {
                const draftNotes = littleThings(d.books[name]);
                d.books[name].sceneArchivistStory = M.copy(saved.sceneArchivistStory);
                setLittleThings(d.books[name], draftNotes);
            }
            this.real.register(archive, name, d.settings.storyBooks?.[archive]?.[name] || (name === archive ? 'archive' : 'separate'));
            d.books[name].sceneArchivistReceipts = M.unique([...(d.books[name].sceneArchivistReceipts || []), ...(saved.sceneArchivistReceipts || [])]);
            for (const c of approval.accepted.filter(c => c.book === name)) {
                if (c.noteId) {
                    job.approvedRecords = M.unique([...(job.approvedRecords || []), c.noteId]);
                    continue;
                }
                const proposedReceipt = M.record(d.books[name].entries[c.uid])?.memoryReceipt;
                d.books[name].entries[c.uid] = M.copy(saved.entries[c.uid]);
                if (proposedReceipt && M.record(d.books[name].entries[c.uid])) M.record(d.books[name].entries[c.uid]).memoryReceipt = proposedReceipt;
                const id = M.record(saved.entries[c.uid])?.id;
                job.approvedRecords = M.unique([...(job.approvedRecords || []), id || `${name}:${c.uid}`]);
            }
        }
        this.real.saveSettings();
        const count = approval.accepted.length, deferred = approval.deferred;
        await this.finalizeCoverage(false);
        delete job.approval; job.phase = 'review'; await this.real.saveMeta();
        await this.real.refreshInfo?.();
        await this.w.loadBooks(); await this.w.render();
        this.real.notify(`Saved ${count} approved changes. ${deferred} prepared results remain for Resume / review.`, 'success');
        return false;
    }

    async finalizeCoverage(complete) {
        const d = this.data, job = this.job, live = this.w.liveState(), chat = this.real.context().chat || [];
        const accepted = new Set(job.approvedRecords || []);
        const saved = ids => complete || (ids?.length && ids.every(id => accepted.has(id)));
        for (const item of d.archiveRanges || []) {
            if (!saved(item.range.ids)) continue;
            const check = item.range.source && M.checkSource(item.range.source, this.w.sourceId(), chat);
            if (check && !check.valid) continue;
            await this.real.afterArchive(item.range, item.days, item.hide);
        }
        const receipts = (d.chatReceipts || []).filter(receipt => saved(receipt.ids));
        live.chatMemoryReceipts = [...new Map([...(live.chatMemoryReceipts || []), ...receipts]
            .map(receipt => [receipt.id, receipt])).values()];
        if (complete && d.trackerReceipt) live.trackerReceipt = d.trackerReceipt.hash;
    }

    async finish(readyOnly = false) {
        await this.initialize();
        const d = this.data, w = this.w, job = this.job;
        if (job.approval) return this.saveApproval();
        await this.validate();
        if (job.status !== 'running') return false;
        if (!d.approved) {
            const changes = this.changes();
            if (readyOnly && !changes.length) { this.real.notify('There are no prepared results to save yet.', 'info'); return false; }
            const needsReview = readyOnly || job.options.flow || job.kind !== 'archive' || this.real.settings().review || job.options.pipeline?.length || job.options.hasFollowups;
            if (needsReview && !job.options.automatic) {
                job.phase = 'review'; await this.real.saveMeta(); w.renderJob();
                const chat = this.real.context().chat || [];
                const current = new Map(Object.values(d.books).flatMap(book => Object.values(book.entries || {})).filter(M.record).map(e => [M.record(e).id, e]));
                for (const change of changes) {
                    if (change.note) {
                        const check = M.checkSource(change.note.source, w.sourceId(), chat);
                        if (!check.valid && !check.foreign) change.warning = 'This message changed since the detail was proposed. Check the source before saving.';
                        continue;
                    }
                    const r = M.record(d.books[change.book].entries[change.uid]);
                    if (!r) continue;
                    const sources = recordSources(r);
                    const changed = sources.some(source => {
                        const check = M.checkSource(source, w.sourceId(), chat);
                        return !check.valid && !check.foreign;
                    });
                    const linked = Object.entries(r.derivedHashes || {}).some(([id, hash]) => current.has(id) && M.hash(current.get(id).content) !== hash);
                    if (changed || linked) change.warning = 'Evidence for this proposal changed. Check the text before accepting it.';
                    if (r.type === 'memory' && !change.before && !change.content) change.warning = 'No new memories were returned.';
                    change.section = r.type === 'memory' ? 'Memories' : r.type === 'tracker' ? 'Trackers' : r.type === 'diary' ? 'Diaries' : 'Archive';
                    const source = sources[0];
                    if (source?.ranges?.length) change.evidence = `${source.actualChatId || 'Chat'} · ${source.ranges.map(range => `#${range.from}–${range.to}`).join(', ')}`;
                    Object.assign(change, d.metrics?.[r.id] || {});
                }
                const order = ['Archive', 'Memories', 'Trackers', 'Diaries', 'Little Things'];
                changes.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
                const note = (readyOnly ? 'Review the prepared results while the remaining stage waits for a retry.' : 'Review the complete run together.')
                    + (d.notices.length ? '\n\n' + d.notices.join('\n') : '');
                const approved = changes.length ? await w.review(changes, readyOnly ? 'Review ready results' : 'Review complete run', note, { partial: true })
                    : await this.real.confirmText(note, { cancelButton: 'Review later' });
                if (!approved) return false;
                for (const c of changes) {
                    if (c.note) {
                        if (c.note.text !== c.content) c.note.quote = '';
                        c.note.text = c.content;
                        continue;
                    }
                    const e = d.books[c.book].entries[c.uid];
                    if (e.content !== c.content) {
                        if (M.record(e)) M.revise(e, c.content, 'Review correction', M.chronology(c.content));
                        else e.content = c.content;
                    }
                }
                const selection = approvedChanges(changes.filter(c => !c.note), d.before, d.books);
                for (const c of changes.filter(c => c.note)) (c.include === false ? selection.deferred : selection.accepted).push(c);
                if (selection.blocked.length) this.real.notify('Results with unselected or missing source entries are still in the draft.', 'info');
                if (readyOnly || selection.deferred.length) {
                    if (!selection.accepted.length) return false;
                    const books = M.copy(d.before);
                    for (const c of selection.accepted) {
                        if (c.note) {
                            setLittleThings(books[c.book], [...littleThings(books[c.book]), M.copy(c.note)], w.state().storyId);
                            continue;
                        }
                        books[c.book].entries[c.uid] = M.copy(d.books[c.book].entries[c.uid]);
                        if (selection.receiptHolds.includes(c)) {
                            const record = M.record(books[c.book].entries[c.uid]);
                            const original = M.record(d.before[c.book]?.entries?.[c.uid])?.memoryReceipt;
                            if (original) record.memoryReceipt = M.copy(original);
                            else delete record.memoryReceipt;
                        }
                    }
                    const approval = { id: job.id + ':approval:' + M.uid(), books: {}, bases: {},
                        accepted: selection.accepted.map(c => c.note ? { book: c.book, noteId: c.note.id } : { book: c.book, uid: c.uid }), deferred: selection.deferred.length };
                    const names = M.unique(selection.accepted.map(c => c.book)), archive = this.real.settings().lorebook;
                    if (books[archive]?.sceneArchivistStory?.shared) {
                        books[archive].sceneArchivistStory.books = { ...(books[archive].sceneArchivistStory.books || {}), [archive]: 'archive' };
                        for (const name of names) books[archive].sceneArchivistStory.books[name] = d.settings.storyBooks?.[archive]?.[name] || 'separate';
                        if (!names.includes(archive)) names.push(archive);
                    }
                    for (const name of names) { approval.books[name] = books[name]; approval.bases[name] = M.bookHash(d.before[name]); }
                    job.approval = approval; await this.real.saveMeta();
                    return this.saveApproval();
                }
            }
            await this.validate();
            d.approved = true; job.phase = 'saving'; await this.real.saveMeta();
        }
        if (job.status !== 'running') return false;
        if (!d.undoStarted) {
            this.real.undoStart();
            for (const [name, original] of Object.entries(d.before)) await this.real.snapshot(name, original);
            d.undoStarted = true; await this.real.saveMeta();
        }
        const archive = this.real.settings().lorebook;
        if (d.books[archive]?.sceneArchivistStory?.shared) d.books[archive].sceneArchivistStory.books = { ...(d.settings.storyBooks?.[archive] || {}), [archive]: 'archive' };
        const ordered = [...Object.entries(d.books).filter(([name]) => name !== archive), ...Object.entries(d.books).filter(([name]) => name === archive)];
        for (const [name, data] of ordered) {
            this.real.assert(); if (job.status !== 'running') return false;
            if (!this.real.context().getWorldInfoNames().includes(name)) await this.real.createBook(name);
            const current = await this.real.load(name);
            const written = current?.sceneArchivistReceipts?.includes(job.id);
            if (M.bookHash(current) !== M.bookHash(written ? data : d.before[name])) {
                throw new Error(`"${name}" changed before saving this bulk run. No further books were written. Refresh and review before retrying.`);
            }
            if (written) { await this.real.confirmRecovered?.(name, current); continue; }
            data.sceneArchivistReceipts = M.unique([...(data.sceneArchivistReceipts || []), job.id]);
            await this.real.save(name, data); this.real.reload(name);
        }
        // Keep the durable live job rather than copying a job into itself.
        const live = this.w.liveState(); Object.assign(live, M.copy(d.meta.workbench));
        live.applied = M.unique([...(live.applied || []), job.id, ...job.steps.map(s => s.id)]);
        for (const key of ['lastDay', 'at', 'messages']) if (key in d.meta) this.real.meta()[key] = d.meta[key];
        for (const [archive, books] of Object.entries(d.settings.storyBooks || {})) for (const [name, kind] of Object.entries(books)) this.real.register(archive, name, kind);
        this.real.settings().lastWriteBooks = Object.keys(d.books); this.real.saveSettings();
        await this.finalizeCoverage(true);
        live.lastWrite = { at: M.now(), reason: 'Complete bulk run', books: Object.keys(d.books) };
        job.phase = 'done'; await this.real.saveMeta();
        await this.real.refreshInfo?.();
        await w.loadBooks(); await w.render();
        this.real.notify(`Finished ${job.steps.length} processing steps. All accepted changes were saved.`, 'success');
        return true;
    }
}

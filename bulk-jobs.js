// A bulk run has a private draft of its books. Only the final approved draft
// reaches the host. Drafts and completed steps live in the durable job itself.
import * as M from './memory-engine.js';
import * as Core from './core.js';
import { archiveOutputId } from './flow.js';
import { approvedChanges, entrySettings, proposalKey } from './workflow-tools.js';
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

function compactDraft(draft) {
    const { books, ...saved } = draft;
    const bookEdits = Object.fromEntries(Object.entries(books).map(([name, book]) => {
        const { entries, ...metadata } = book, original = draft.before[name]?.entries || {};
        const changed = Object.fromEntries(Object.entries(entries || {}).filter(([uid, entry]) => JSON.stringify(original[uid]) !== JSON.stringify(entry)));
        return [name, { metadata, changed, removed: Object.keys(original).filter(uid => !Object.hasOwn(entries || {}, uid)) }];
    }));
    return { ...saved, bookEdits };
}

function restoreDraft(draft) {
    if (draft.bookEdits && !draft.books) {
        draft.books = Object.fromEntries(Object.entries(draft.bookEdits).map(([name, edit]) => {
            const entries = M.copy(draft.before[name]?.entries || {});
            for (const uid of edit.removed) delete entries[uid];
            return [name, { ...edit.metadata, entries: { ...entries, ...edit.changed } }];
        }));
        delete draft.bookEdits;
    }
    if (!Object.hasOwn(draft, 'toJSON')) {
        Object.defineProperty(draft, 'toJSON', { value: () => compactDraft(draft) });
    }
    return draft;
}

export class BulkRun {
    constructor(workbench, job) {
        this.w = workbench; this.job = job; this.real = workbench.baseHost;
    }
    async initialize() {
        if (!this.job.draft) {
            await this.w.loadBooks();
            const meta = this.real.meta();
            const state = { ...this.w.liveState(), job: undefined, recapSuggestions: undefined };
            this.job.draft = {
                books: M.copy(this.w.books), before: M.copy(this.w.books),
                meta: M.copy({ ...meta, undo: undefined, journals: undefined, workbench: state }),
                settings: M.copy(this.real.settings()), notices: [], archiveRanges: [],
                approved: false, undoStarted: false,
            };
            restoreDraft(this.job.draft);
            await this.real.saveMeta();
        }
        this.data = restoreDraft(this.job.draft);
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
            afterArchive: async (range, days, hide, archiveIds) => {
                if (!d.archiveRanges.some(r => r.range.stepId === range.stepId)) d.archiveRanges.push({ range, days, hide, archiveIds });
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
    async acceptArchive(text, source, stepId, placement = null, combined = false) {
        const w = this.w, d = this.data, name = d.settings.lorebook;
        const data = M.copy(d.books[name] || { entries: {} }), before = M.copy(data);
        const { parsed, plan, littleThings: proposed } = await this.real.prepareArchive(text, data, source, placement);
        if (!plan.adds.some(a => a.include && a.content.trim()) && !plan.states.some(a => a.include && a.content.trim())) {
            throw new Error('This archive pass proposed no new entries or state changes. Its range remains pending.');
        }
        const applied = Core.applyPlan(data, plan, parsed, this.real.options(), book => this.real.makeEntry(name, book));
        const changed = M.captureChanges(data, before, Core.classifyEntry, { storyId: w.state().storyId, source, reason: 'Archive write' });
        for (const e of Object.values(data.entries)) if (M.record(e)?.storyId === w.state().storyId) e.sceneArchivistArchive = name;
        if (!this.job.options.automatic && proposed?.length) addLittleThings(data, w.archiveLittleThings(proposed, source), w.state().storyId);

        data.sceneArchivistReceipts = M.unique([...(data.sceneArchivistReceipts || []), stepId]);
        d.books[name] = data;
        d.meta.lastDay = Core.managedSummary(data).lastDay;
        d.meta.at = Date.now(); d.meta.messages = this.real.context().chat?.length ?? 0;
        for (const warning of plan.warnings || []) if (!d.notices.includes(warning)) d.notices.push(warning);
        const units = Object.values(data.entries).filter(e => M.record(e)?.type === 'unit');
        const saved = new Set(units.map(e => M.record(e).id));
        const archiveIds = combined ? Object.fromEntries(applied.outputUnitUids.flatMap((uid, index) => {
            const entry = data.entries[uid], r = M.record(entry);
            return r?.type === 'unit' && M.active(entry) ? [[archiveOutputId(index), r.id]] : [];
        })) : undefined;
        return { ids: changed.filter(id => saved.has(id)), days: plan.adds.filter(a => a.include).map(a => a.dayNum).filter(Number.isInteger), archiveIds };
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
        let newConflict = false, recheckSources = false;
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
                if (notes) {
                    for (const uid of keys) {
                        const before = original.entries?.[uid], saved = current.entries?.[uid], proposed = draft.entries?.[uid];
                        const key = proposalKey({ book: name, uid });
                        if (same(saved, before)) continue;
                        if (same(before, proposed) || same(saved, proposed)) {
                            const id = M.record(before)?.id;
                            if (id && (id !== M.record(saved)?.id || before.content !== saved?.content)) {
                                (d.sourceEdits ??= {})['#' + id] ??= M.hash(before.content);
                                recheckSources = true;
                            }
                            if (saved) draft.entries[uid] = M.copy(saved);
                            else delete draft.entries[uid];
                            delete d.conflicts?.[key];
                        } else if (proposed) {
                            const conflict = ((d.conflicts ??= {})[key] ??= { original: before?.content ?? null });
                            conflict.sourceIds = M.unique([...(conflict.sourceIds || []), M.record(before)?.id, M.record(proposed)?.id]);
                            const edit = this.job.reviewEdits?.[key];
                            if (edit) edit.include = false;
                            newConflict = true;
                        } else {
                            throw new Error(`An entry in "${name}" changed while this job proposed removing it. Review the saved entry before retrying.`);
                        }
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
        if (!newConflict && recheckSources) {
            const changes = this.changes(); this.holdConflicts(changes);
            newConflict = changes.some(c => c.conflict);
        }
        if (newConflict) d.approved = false;
        return newConflict;
    }

    holdConflicts(changes) {
        const d = this.data;
        const held = new Set(Object.values(d.conflicts || {}).flatMap(c => c.sourceIds));
        if (!held.size && !d.sourceEdits) return;
        const saved = new Map(Object.values(d.before).flatMap(book => Object.values(book.entries || {})).filter(M.record).map(e => [M.record(e).id, e]));
        const pending = changes.filter(c => !c.note);
        for (const c of pending) {
            const conflict = d.conflicts?.[proposalKey(c)];
            if (conflict) c.conflict = { original: conflict.original, message: 'This entry changed in World Info after the job prepared its draft. The saved entry takes priority.' };
        }
        let added;
        do {
            added = false;
            for (const c of pending.filter(c => !c.conflict)) {
                const r = M.record(d.books[c.book].entries[c.uid]);
                const id = M.unique([...(r?.derivedFrom || []), ...(r?.covers || [])]).find(id => {
                    if (held.has(id)) return true;
                    const earlierHash = d.sourceEdits?.['#' + id];
                    return earlierHash && (!saved.has(id) || M.hash(saved.get(id).content) !== (r.derivedHashes?.[id] || earlierHash));
                });
                if (!id) continue;
                c.conflict = { message: 'This proposal used a source affected by a World Info edit. Review or rebuild it from the saved source.' };
                held.add(r.id); added = true;
            }
        } while (added);
        for (const c of pending.filter(c => c.conflict)) c.include = false;
    }

    discardConflict(change) {
        const d = this.data, job = this.job, { book, uid } = change;
        const proposed = d.books[book].entries[uid], saved = d.before[book]?.entries?.[uid], r = M.record(proposed);
        if (saved) d.books[book].entries[uid] = M.copy(saved);
        else delete d.books[book].entries[uid];
        const key = proposalKey(change);
        d.dropped = (d.dropped || 0) + 1;
        if (r) {
            (d.sourceEdits ??= {})['#' + r.id] = M.hash(proposed.content);
            const conflict = d.conflicts?.[key];
            for (const id of conflict?.sourceIds || []) if (id !== r.id) d.sourceEdits['#' + id] = M.hash(conflict.original || '');
            if (r.type === 'memory') for (const [name, draft] of Object.entries(d.books)) for (const e of Object.values(draft.entries || {})) {
                const source = M.record(e);
                if (!source?.memoryReceipt || !r.derivedFrom?.includes(source.id)) continue;
                const receipt = M.record(d.before[name]?.entries?.[e.uid])?.memoryReceipt;
                if (receipt) source.memoryReceipt = M.copy(receipt);
                else delete source.memoryReceipt;
            }
        }
        delete d.conflicts?.[key];
        delete job.reviewEdits?.[key];
    }
    async saveApproval() {
        const job = this.job, d = this.data, approval = job.approval;
        this.real.undoStart();
        const archive = this.real.settings().lorebook;
        const ordered = [...Object.entries(approval.books).filter(([name]) => name !== archive), ...Object.entries(approval.books).filter(([name]) => name === archive)];
        const written = new Map();
        let reviewAgain = false;
        for (const [name, target] of ordered) {
            this.real.assert();
            const current = await this.real.load(name);
            const applied = current?.sceneArchivistReceipts?.includes(approval.id);
            if (applied) {
                written.set(name, target);
                if (M.bookHash(current) === M.bookHash(target)) await this.real.confirmRecovered?.(name, current);
                else reviewAgain = true;
                continue;
            }
            if (M.bookHash(current) !== approval.bases[name]) reviewAgain = true;
            if (reviewAgain) continue;
            if (!this.real.context().getWorldInfoNames().includes(name)) await this.real.createBook(name);
            await this.real.snapshot(name, current || { entries: {} });
            target.sceneArchivistReceipts = M.unique([...(target.sceneArchivistReceipts || []), approval.id]);
            await this.real.saveMeta(); // Persist the exact save intent before the request.
            await this.real.save(name, target); this.real.reload(name); await this.real.saveMeta();
            written.set(name, target);
        }
        for (const [name, saved] of written) {
            d.before[name] = M.copy(saved);
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
        const count = approval.accepted.filter(c => written.has(c.book)).length;
        await this.finalizeCoverage(false);
        delete job.approval; job.phase = 'review'; await this.real.saveMeta();
        if (reviewAgain) {
            await this.validate(); await this.real.saveMeta();
            this.real.notify('World Info changed during approval. Reopen the review to see which proposals are still pending.', 'info');
        }
        await this.real.refreshInfo?.();
        await this.w.loadBooks(); await this.w.render();
        if (!reviewAgain) this.real.notify(`Saved ${count} approved changes. ${approval.deferred} prepared results remain for Resume / review.`, 'success');
        return false;
    }

    async finalizeCoverage(complete) {
        const d = this.data, job = this.job, live = this.w.liveState(), chat = this.real.context().chat || [];
        const accepted = new Set(job.approvedRecords || []);
        const saved = ids => (complete && !d.dropped) || (ids?.length && ids.every(id => accepted.has(id)));
        for (const item of d.archiveRanges || []) {
            if (!saved(item.range.ids)) continue;
            const check = item.range.source && M.checkSource(item.range.source, this.w.sourceId(), chat);
            if (check && !check.valid) continue;
            await this.real.afterArchive(item.range, item.days, item.hide);
        }
        const receipts = (d.chatReceipts || []).filter(receipt => saved(receipt.ids));
        live.chatMemoryReceipts = [...new Map([...(live.chatMemoryReceipts || []), ...receipts]
            .map(receipt => [receipt.id, receipt])).values()];
        if (complete && d.trackerReceipt && saved(d.trackerReceipt.ids)) live.trackerReceipt = d.trackerReceipt.hash;
    }

    async finish(readyOnly = false) {
        await this.initialize();
        const d = this.data, w = this.w, job = this.job;
        if (job.approval) return this.saveApproval();
        await this.validate();
        if (job.status !== 'running') return false;
        if (!d.approved) {
            const changes = this.changes();
            this.holdConflicts(changes);
            const conflicts = changes.some(c => c.conflict);
            if (readyOnly && !changes.length) { this.real.notify('There are no prepared results to save yet.', 'info'); return false; }
            const needsReview = readyOnly || job.options.flow || job.kind !== 'archive' || this.real.settings().review || job.options.pipeline?.length || job.options.hasFollowups;
            if (conflicts || (needsReview && !job.options.automatic)) {
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
                    const { memoryWarning, stepId, ...metrics } = d.metrics?.[r.id] || {};
                    Object.assign(change, metrics);
                    if (memoryWarning) change.warning = [change.warning, memoryWarning].filter(Boolean).join(' ');
                    if (change.conflict && Object.hasOwn(change.conflict, 'original')) {
                        change.beforeLabel = 'Saved in World Info';
                        delete change.beforeTokens;
                    }
                    if (r.type === 'recap' && !change.before && r.covers?.length) {
                        const compared = job.steps.find(step => step.id === stepId)?.output?.results?.[0]?.before;
                        const sources = r.covers.map(id => current.get(id)?.content);
                        if (compared || sources.every(text => typeof text === 'string')) {
                            change.before = compared || sources.join('\n\n');
                            change.beforeLabel = compared ? 'Original source entries' : 'Source entries';
                            change.afterLabel = 'Proposed recap';
                            if (linked && !compared) delete change.beforeTokens;
                        }
                    }
                }
                const order = ['Archive', 'Memories', 'Trackers', 'Diaries', 'Little Things'];
                changes.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
                const note = (readyOnly ? 'Review the prepared results while the remaining stage waits for a retry.' : 'Review the complete run together.')
                    + (conflicts ? ' You can save unaffected results now. Held proposals stay here for review unless you discard them individually.' : '')
                    + (d.notices.length ? '\n\n' + d.notices.join('\n') : '');
                const approved = changes.length ? await w.review(changes, readyOnly ? 'Review ready results' : 'Review complete run', note, { partial: true })
                    : await this.real.confirmText(note, { cancelButton: 'Review later' });
                if (!approved) return false;
                if (await this.validate()) {
                    this.real.notify('Another World Info edit arrived during review. Reopen the review to see the saved changes.', 'info');
                    return false;
                }
                const discarded = changes.filter(c => c.conflict && c.discard);
                for (const c of discarded) this.discardConflict(c);
                if (discarded.length) await this.real.saveMeta();
                for (const c of changes) {
                    if (c.conflict) continue;
                    if (c.note) {
                        if (c.include === false) {
                            const book = d.books[c.book];
                            setLittleThings(book, littleThings(book).filter(note => note.id !== c.note.id));
                            delete job.reviewEdits?.[proposalKey(c)];
                            continue;
                        }
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
                const selection = approvedChanges(changes.filter(c => !c.note && !discarded.includes(c)), d.before, d.books);
                selection.accepted.push(...changes.filter(c => c.note && c.include !== false));
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
                if (d.dropped) d.finalRecords = selection.accepted.filter(c => !c.note).map(c => M.record(d.books[c.book].entries[c.uid])?.id);
            }
            if (await this.validate()) return false;
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
        const live = this.w.liveState();
        const { recapSuggestions, ...preparedState } = M.copy(d.meta.workbench);
        Object.assign(live, preparedState);
        live.applied = M.unique([...(live.applied || []), job.id, ...job.steps.map(s => s.id)]);
        if (d.dropped && d.archiveRanges.length) d.meta.lastDay = Core.managedSummary(d.books[archive]).lastDay;
        for (const key of ['lastDay', 'at', 'messages']) if (key in d.meta) this.real.meta()[key] = d.meta[key];
        for (const [archive, books] of Object.entries(d.settings.storyBooks || {})) for (const [name, kind] of Object.entries(books)) this.real.register(archive, name, kind);
        this.real.settings().lastWriteBooks = Object.keys(d.books); this.real.saveSettings();
        if (d.finalRecords) job.approvedRecords = M.unique([...(job.approvedRecords || []), ...d.finalRecords]);
        await this.finalizeCoverage(true);
        live.lastWrite = { at: M.now(), reason: 'Complete bulk run', books: Object.keys(d.books) };
        job.phase = 'done'; await this.real.saveMeta();
        await this.real.refreshInfo?.();
        await w.loadBooks(); await w.render();
        const outcome = d.dropped ? ` Discarded ${d.dropped} held ${d.dropped === 1 ? 'proposal' : 'proposals'}.` : '';
        this.real.notify(`Finished ${job.steps.length} processing steps. All accepted changes were saved.${outcome}`, 'success');
        return true;
    }
}

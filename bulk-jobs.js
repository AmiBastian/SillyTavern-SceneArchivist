// A bulk run has a private draft of its books. Only the final approved draft
// reaches the host. Drafts and completed steps live in the durable job itself.
import * as M from './memory-engine.js';
import * as Core from './core.js';
import { approvedChanges, entrySettings } from './workflow-tools.js';
import { same } from './entry-journal.js';
import { approvalMessage, recordSources } from './recovery-tools.js';

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
        const limit = this.real.settings().workbench?.requestBudget;
        if (Number.isFinite(limit)) (this.data.settings.workbench ??= {}).requestBudget = limit;
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
    async acceptArchive(text, source, stepId) {
        const w = this.w, d = this.data, name = d.settings.lorebook;
        const data = M.copy(d.books[name] || { entries: {} }), before = M.copy(data);
        const { parsed, plan } = await this.real.prepareArchive(text, data, source);
        if (!plan.adds.some(a => a.include && a.content.trim()) && !plan.states.some(a => a.include && a.content.trim())) {
            throw new Error('This archive pass proposed no new entries or state changes. Its range remains pending.');
        }
        Core.applyPlan(data, plan, parsed, this.real.options(), book => this.real.makeEntry(name, book));
        const changed = M.captureChanges(data, before, Core.classifyEntry, { storyId: w.state().storyId, source, reason: 'Archive write' });
        for (const e of Object.values(data.entries)) if (M.record(e)?.storyId === w.state().storyId) e.sceneArchivistArchive = name;
        M.invalidate(Object.values(data.entries), changed.filter(id => Object.values(before.entries || {}).some(e => M.record(e)?.id === id)), 'An archive source was updated');
        data.sceneArchivistReceipts = M.unique([...(data.sceneArchivistReceipts || []), stepId]);
        d.books[name] = data;
        d.meta.lastDay = Core.managedSummary(data).lastDay;
        d.meta.at = Date.now(); d.meta.messages = this.real.context().chat?.length ?? 0;
        for (const warning of plan.warnings || []) if (!d.notices.includes(warning)) d.notices.push(warning);
        return { days: plan.adds.filter(a => a.include).map(a => a.dayNum).filter(Number.isInteger) };
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
            if (M.bookHash(current) !== M.bookHash(expected)) throw new Error(`"${name}" changed while this bulk run was waiting. Cancel this job and choose the corrected sources; no further books were written.`);
        }
        const state = this.w.liveState(), chat = this.real.context().chat || [];
        for (const data of Object.values(d.books)) for (const e of Object.values(data.entries || {})) {
            const r = M.record(e);
            if (r?.storyId !== state.storyId || r.status !== 'current') continue;
            const checks = recordSources(r).map(source=>M.checkSource(source, this.w.sourceId(), chat));
            if (checks.some(check=>!check.valid&&!check.foreign)) throw new Error('A source transcript changed during this bulk run. Cancel it and select the current messages.');
        }
        for (const step of this.job.steps) if (step.payload.source && !M.checkSource(step.payload.source, this.w.sourceId(), chat).valid) {
            throw new Error('An archive source range changed during this bulk run. Cancel it and select the current messages.');
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
            if (saved.sceneArchivistStory) d.books[name].sceneArchivistStory = M.copy(saved.sceneArchivistStory);
            this.real.register(archive, name, d.settings.storyBooks?.[archive]?.[name] || (name === archive ? 'archive' : 'separate'));
            d.books[name].sceneArchivistReceipts = M.unique([...(d.books[name].sceneArchivistReceipts || []), ...(saved.sceneArchivistReceipts || [])]);
            for (const c of approval.accepted.filter(c => c.book === name)) {
                d.books[name].entries[c.uid] = M.copy(saved.entries[c.uid]);
                const id = M.record(saved.entries[c.uid])?.id;
                job.approvedRecords = M.unique([...(job.approvedRecords || []), id || `${name}:${c.uid}`]);
            }
        }
        this.real.saveSettings();
        const count = approval.accepted.length, deferred = approval.deferred;
        delete job.approval; job.phase = 'review'; await this.real.saveMeta();
        await this.real.refreshInfo?.();
        await this.w.loadBooks(); await this.w.render();
        this.real.notify(`Saved ${count} approved changes. ${deferred} prepared results remain for Resume / review.`, 'success');
        return false;
    }

    async finish() {
        await this.initialize();
        const d = this.data, w = this.w, job = this.job;
        if (job.approval) return this.saveApproval();
        await this.validate();
        if (job.status !== 'running') return false;
        if (!d.approved) {
            const changes = this.changes();
            const needsReview = job.kind !== 'archive' || this.real.settings().review || job.options.pipeline?.length || job.options.hasFollowups;
            if (needsReview && !job.options.automatic) {
                job.phase = 'review'; await this.real.saveMeta(); w.renderJob();
                const note = `All ${job.steps.length} processing steps are ready. Review ${changes.length} changed records together. ${job.approvedRecords?.length ? `${job.approvedRecords.length} approved records have already been saved; the remaining proposals are kept here.` : 'Nothing has been written to your story books yet.'} Choose "Review later" to keep the prepared results for Resume / review. "Discard unfinished job" in the job panel abandons them.` + (d.notices.length ? '\n\n' + d.notices.join('\n') : '');
                const accepted = changes.length ? await w.review(changes, 'Review complete run', note, { partial: true }) : await this.real.confirmText(note, { cancelButton: 'Review later' });
                // Keep edits even when the author closes this review for later.
                const reviewEdited = [];
                for (const c of changes) {
                    const e = d.books[c.book].entries[c.uid];
                    if (e.content !== c.content) { if (M.record(e)) { M.revise(e, c.content, 'Combined review correction'); reviewEdited.push(M.record(e).id); } else e.content = c.content; }
                }
                M.invalidate(Object.values(d.books).flatMap(b => Object.values(b.entries || {})), reviewEdited, 'A proposed source was corrected during review');
                if (!accepted) return false;
                let selection = approvedChanges(changes, d.before, d.books);
                const repairable = selection.blocked.filter(b => b.problems?.length && b.problems.every(p => !['unchecked','receipt'].includes(p.reason)) && changes.some(c=>c.book===b.book&&c.uid===b.uid&&c.include!==false));
                if (!selection.accepted.length && repairable.length) {
                    const keep = await this.real.confirmText(approvalMessage(selection.blocked) + '\n\nYou can also save the selected outdated results as Needs review. They stay excluded from memory injection until their sources are repaired. Their text, old source hashes, and revisions are retained; new memory receipts stay pending.', {okButton:'Save as needing review',cancelButton:'Review later'});
                    if(!keep)return false;
                    for(const b of repairable){const r=M.record(d.books[b.book].entries[b.uid]);r.status='stale';r.staleReason='Saved for repair after approval: '+b.problems.map(p=>`${p.title}: ${p.reason}`).join('; ');}
                    selection=approvedChanges(changes,d.before,d.books);
                }
                for(const c of selection.receiptHolds)delete M.record(d.books[c.book].entries[c.uid]).memoryReceipt;
                if (selection.deferred.length) {
                    if (!selection.accepted.length) throw new Error(approvalMessage(selection.blocked));
                    if (selection.blocked.length && !(await this.real.confirmText(approvalMessage(selection.blocked) + `\n\nSave the ${selection.accepted.length} independent approved changes and keep the other results for later?`, {okButton: 'Save independent results', cancelButton: 'Review later'}))) return false;
                    const books = M.copy(d.before);
                    for (const c of selection.accepted) books[c.book].entries[c.uid] = M.copy(d.books[c.book].entries[c.uid]);
                    const approval = { id: `${job.id}:approval:${M.uid()}`, books: {}, bases: {}, accepted: selection.accepted.map(c => ({ book: c.book, uid: c.uid })), deferred: selection.deferred.length };
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
                if (job.status !== 'running') return false;
                const edited = [];
                for (const c of changes) {
                    const e = d.books[c.book].entries[c.uid];
                    if (e.content !== c.content) {
                        if (M.record(e)) { Object.assign(M.record(e), { contentHash: M.hash(c.content), lastContent: c.content, updated: M.now() }); edited.push(M.record(e).id); }
                        e.content = c.content;
                        if (M.record(e)?.type === 'unit') Object.assign(M.record(e), M.chronology(e.content));
                    }
                }
                // A manual correction to a proposed source must not leave its
                // already-generated descendants falsely marked current.
                M.invalidate(Object.values(d.books).flatMap(b => Object.values(b.entries || {})), edited, 'A proposed source was edited in the combined review');
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
        for (const item of d.archiveRanges) await this.real.afterArchive(item.range, item.days, item.hide);
        live.lastWrite = { at: M.now(), reason: 'Complete bulk run', books: Object.keys(d.books) };
        job.phase = 'done'; await this.real.saveMeta();
        await this.real.refreshInfo?.();
        await w.loadBooks(); await w.render();
        this.real.notify(`Finished ${job.steps.length} processing steps. All accepted changes were saved.`, 'success');
        return true;
    }
}

import * as M from './memory-engine.js';
import { flashbackReason, littleThings, noteAudience, noteRecall, packLittleThings, recallFrame, recordRecall } from './little-things.js';

export class SceneRecall {
    constructor(workbench) {
        this.w = workbench;
        this.carry = new Map();
        this.requested = new Set();
    }

    reset() {
        this.clearPrompt();
        this.run = null;
        this.archive = '';
        this.carry.clear();
        this.requested.clear();
    }

    clearPrompt() { this.w.h.setLittleThingsPrompt?.(''); }

    finish() {
        if (this.run) this.run.finished = true;
        this.clearPrompt();
    }

    setArchive(archive) {
        if (this.archive === archive) return;
        this.carry.clear();
        this.requested.clear();
        this.archive = archive;
    }

    request(id) {
        this.setArchive(this.w.h.settings().lorebook);
        this.requested.add(id);
    }

    begin(type, enabled) {
        const w = this.w, archive = w.h.settings().lorebook;
        this.clearPrompt();
        this.setArchive(archive);
        this.run = enabled ? { type, archive, identity: w.identity(), epoch: w.generationEpoch } : null;
    }

    current(run) {
        const w = this.w;
        return !!run && this.run === run && run.epoch === w.generationEpoch && run.identity === w.identity() &&
            run.archive === w.h.settings().lorebook && !w.scanSuppressed && !w.h.isBusy();
    }

    async prepare(entries, group) {
        const w = this.w, run = this.run;
        if (!this.current(run) || run.finished || !w.h.scanSupported || !w.h.setLittleThingsPrompt) return;
        const automatic = w.options().sceneRecall;
        if (!automatic && !this.requested.size) return;
        const context = w.h.context(), chat = context.chat || [];
        const card = group ? group.members.find(member => member.avatar === group.speaker) :
            context.characters?.[context.characterId];
        const names = M.unique(group ? [card?.name, ...(card?.aliases || [])] : [context.name2, card?.name, card?.data?.nickname]);
        // An unresolved branch may still point at the parent's active archive.
        if (w.state().branchIntent || w.state().originChat && w.state().originChat !== w.identity()) return;
        const frame = recallFrame(chat, run.type, names);
        const book = await w.h.recallBook(run.archive);
        if (!this.current(run) || run.finished) return;
        const speaker = { names, group, avatar: card?.avatar, currentAvatar: w.h.currentAvatar };
        const ranked = noteRecall(littleThings(book), { frame, chat, speaker,
            sourceId: w.sourceId(), carry: this.carry, requested: this.requested });
        const budget = Math.min(280, Math.floor(Math.max(0, Number(w.options().budget) || 0) * 0.2));
        const count = async value => {
            try { return (Number(await w.h.tokenCount?.(value)) || M.tokens(value)) + 4; }
            catch { return M.tokens(value) + 4; }
        };
        const packed = await packLittleThings(automatic ? ranked : ranked.filter(item => this.requested.has(item.note.id)), budget, count);
        if (!this.current(run) || run.finished) return;
        run.frame = frame;
        run.packed = packed;
        run.records = automatic ? recordRecall(entries.filter(e => {
            if (w.memoryScopeReason(e, group)) return false;
            const r = M.record(e);
            return r.type !== 'knowledge' || !!r.subject && noteAudience({ knows: [r.subject], knownAvatar: r.subjectAvatar }, speaker);
        }), frame, chat, this.carry) : [];
        w.h.setLittleThingsPrompt(packed.text);
    }

    reason(entry) { return this.w.options().sceneRecall && this.run?.frame ? flashbackReason(entry, this.run.frame) : ''; }

    selection() { return this.run?.packed || { items: [], tokens: 0 }; }
    recordReasons() { return new Map((this.run?.records || []).map(item => [M.record(item.entry).id, item.reason])); }

    receive(accepted, index) {
        const run = this.run;
        if (!this.current(run) || !run.frame) return;
        const { frame, packed, records } = run;
        const loaded = new Set(accepted.map(item => item.id));
        this.carry = new Map([...this.carry].filter(([, item]) => item.index >= frame.boundary && item.index >= index - 12));
        for (const item of [...packed.items, ...records.filter(match => loaded.has(M.record(match.entry).id))]) {
            const id = item.note?.id || M.record(item.entry).id;
            this.requested.delete(id);
            if (item.anchor && item.reason !== 'Carried from this scene') {
                this.carry.set(id, { index: item.anchor.index, hash: item.anchor.hash, date: frame.date, place: frame.place });
            }
        }
    }
}

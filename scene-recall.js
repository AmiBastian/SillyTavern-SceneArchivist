import * as M from './memory-engine.js';
import { flashbackReason, littleThings, noteAudience, noteRecall, packLittleThings, recallFrame, recordRecall, setFlashback } from './little-things.js';

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

    begin(type, enabled, pending = '') {
        const w = this.w, archive = w.h.settings().lorebook;
        this.clearPrompt();
        this.setArchive(archive);
        this.run = enabled ? { type, archive, identity: w.identity(), epoch: w.generationEpoch, packed: { items: [], tokens: 0 }, records: [] } : null;
        if (this.run && w.options().sceneRecall) this.run.frame = this.frame(type, pending);
    }

    frame(type = 'normal', pending = '', names = []) {
        const w = this.w, { chat = [], name1 } = w.h.context();
        const transcript = pending ? [...chat, { mes: pending, name: name1, is_user: true }] : chat;
        return recallFrame(transcript, type, names, w.h.meta().sceneOpeningFlashback);
    }

    setFlashback(date) {
        const w = this.w;
        setFlashback(w.h.context().chat || [], w.h.meta(), date);
        this.carry.clear();
    }

    current(run) {
        const w = this.w;
        return !!run && this.run === run && run.epoch === w.generationEpoch && run.identity === w.identity() &&
            run.archive === w.h.settings().lorebook && !w.scanSuppressed && !w.h.isBusy();
    }

    async prepare(entries, group, excluded) {
        const w = this.w, run = this.run;
        if (!this.current(run) || run.finished) return;
        const scene = this.describe(run.type, group);
        run.frame = scene.frame;
        if (!w.h.scanSupported || !w.h.setLittleThingsPrompt) return;
        // An unresolved branch may still point at the parent's active archive.
        if (w.state().branchIntent || w.state().originChat && w.state().originChat !== w.identity()) return;
        const book = await w.h.recallBook(run.archive);
        if (!this.current(run) || run.finished) return;
        const { packed, records } = await this.plan(entries, scene, book, excluded, run.choices);
        if (!this.current(run) || run.finished) return;
        run.packed = packed;
        run.records = records;
        w.h.setLittleThingsPrompt(packed.text);
    }

    describe(type, group, pending = '') {
        const { h } = this.w, context = h.context();
        const card = group ? group.members.find(member => member.avatar === group.speaker) : context.characters?.[context.characterId];
        const names = M.unique(group ? [card?.name, ...(card?.aliases || [])] : [context.name2, card?.name, card?.data?.nickname]);
        return { frame: this.frame(type, pending, names), chat: context.chat || [], speaker: { names, group, avatar: card?.avatar, currentAvatar: h.currentAvatar } };
    }

    async plan(entries, { frame, chat, speaker }, book, excluded, choices = new Map()) {
        const w = this.w, automatic = w.options().sceneRecall;
        const requested = new Set(this.archive === w.h.settings().lorebook ? this.requested : []);
        const notes = littleThings(book);
        for (const note of notes) if (choices.get('little:' + note.id) === 'load') requested.add(note.id);
        const carry = this.archive === w.h.settings().lorebook ? this.carry : new Map();
        if (!automatic && !requested.size) return { packed: { text: '', items: [], tokens: 0 }, records: [], ranked: [] };
        const ranked = noteRecall(notes.filter(note => choices.get('little:' + note.id) !== 'skip'), { frame, chat, speaker, sourceId: w.sourceId(), carry, requested });
        const budget = Math.min(280, Math.floor(Math.max(0, Number(w.options().budget) || 0) * 0.2));
        const count = async value => {
            try { return (Number(await w.h.tokenCount?.(value)) || M.tokens(value)) + 4; }
            catch { return M.tokens(value) + 4; }
        };
        const eligible = automatic ? ranked : ranked.filter(item => requested.has(item.note.id));
        const cutoff = automatic && frame.flashback ? `The scene is a flashback. Use story knowledge up to ${frame.flashback}.` : '';
        const packed = await packLittleThings(eligible, budget, count, cutoff);
        const records = automatic ? recordRecall(entries.filter(e => {
            if (excluded(e)) return false;
            const r = M.record(e);
            return r.type !== 'knowledge' || !!r.subject && noteAudience({ knows: [r.subject], knownAvatar: r.subjectAvatar }, speaker);
        }), frame, chat, carry) : [];
        return { packed, records, ranked: eligible };
    }

    restriction({ live = false } = {}) {
        if (!this.w.options().sceneRecall) return () => '';
        const run = this.run;
        const frame = !live && run && !run.finished && run.frame || this.frame();
        return frame.flashback ? entry => flashbackReason(entry, frame) : () => '';
    }

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

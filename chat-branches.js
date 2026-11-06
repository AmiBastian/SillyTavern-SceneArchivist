import * as M from './memory-engine.js';
import * as Core from './core.js';
import { isChatRename } from './chat-workflows.js';
import { projectBranch } from './recovery-tools.js';

/** Metadata copied into a named branch is detached before the first new write. */
export async function ensureChatBranch(w) {
    // A story id is not a chat identity. During startup or before a chat
    // opens, using it as a fork signal can repeatedly clone the archive.
    if (!(w.h.context().chatId || w.h.context().chatMetadata?.chat_id)) return;
    const state = w.state(), identity = w.identity();
    if (!identity) return;
    state.sourceId ||= state.storyId;
    const s = w.h.settings(), oldArchive = s.lorebook, oldMemory = w.h.memoryBook();
    if (!oldArchive) { state.originChat = identity; return; }
    await w.loadBooks();
    const shared = w.books[oldArchive]?.sceneArchivistStory;
    const branchMode = w.options().branchMode === 'fresh' ? 'fresh' : 'prune';
    const metadata = w.h.context().chatMetadata || {};
    const integrity = metadata.integrity || '';
    const parentChat = String(metadata.main_chat || '');
    // CHAT_CHANGED precedes CHAT_RENAMED on current SillyTavern.
    const previous = state.branchIntent?.identity || state.originChat;
    const renamed = w.h.wasRenamed?.(previous, identity) || await isChatRename({
        previous, current: identity, parent: parentChat, integrity, previousIntegrity: state.branchIntent?.chatIntegrity || state.chatIntegrity, listFiles: w.h.listChatFiles,
    });
    if (identity !== w.identity() || state !== w.state()) throw new Error('The chat changed while checking its identity.');
    if (renamed && !state.branchIntent) {
        state.originChat = identity;
        await w.persist();
    }
    const nativeBranch = parentChat && /(?:^Branch #\d+ - | - Branch #\d+$)/i.test(identity);
    const copiedChat = !!(state.originChat && state.originChat !== identity);
    const legacySharedBranch = nativeBranch && shared?.shared && state.sharedArchive === oldArchive && !state.branchLineage;
    if (shared?.shared && !copiedChat && !legacySharedBranch) {
        state.storyId = shared.id; state.sharedArchive = oldArchive; state.originChat = identity; state.chatIntegrity = integrity;
        if (shared.memoryBook) s.memoryBook = shared.memoryBook;
        if (shared.memoryTarget) s.memoryTarget = shared.memoryTarget;
        for (const [name, kind] of Object.entries(shared.books || {})) w.h.register(oldArchive, name, kind);
        await w.persist(); await w.loadBooks(); return;
    }
    const detachedShared = state.sharedArchive === oldArchive;
    const foreignRecords = detachedShared || legacySharedBranch || w.entries.some(e => M.record(e)?.storyId && M.record(e).storyId !== state.storyId);
    if (!state.originChat && !foreignRecords) { state.originChat = identity; state.chatIntegrity = integrity; await w.persist(); return; }
    if (state.originChat === identity && !foreignRecords) {
        if (integrity && !state.chatIntegrity) { state.chatIntegrity = integrity; await w.persist(); }
        return;
    }
    const parent = copiedChat ? state.originChat : parentChat;
    const parentSource = legacySharedBranch && w.entries.map(e => M.record(e)?.source).find(source => source?.actualChatId === parent && source.ranges?.length)?.chatId;
    const oldSource = parentSource || w.sourceId(), newId = M.uid(), newSource = M.uid(), mapping = {};
    const existing = w.h.context().getWorldInfoNames();
    const suffix = identity.match(/Branch #\d+/i)?.[0] || identity.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 24) || 'Branch';
    for (const old of Object.keys(w.books)) {
        const root = old.replace(/\s*(?:\[branch [^\]]+\]| · Branch #\d+(?: \(\d+\))?)$/i, '').trim();
        const base = `${root.slice(0, 48)} · ${suffix}`;
        let name = base, ordinal = 2;
        while (existing.includes(name) || Object.values(mapping).includes(name)) name = `${base} (${ordinal++})`;
        mapping[old] = name;
    }
    const owned = Object.fromEntries(Object.entries(w.books).map(([name,data])=>[name,{...data,entries:w.h.own(data,name).entries}]));
    const projected = projectBranch(owned, {mode: branchMode, oldSource, sourceId: newSource, storyId: newId, chatId: identity, chat: w.h.context().chat || [], archive: oldArchive, mapping});
    // Persist a deterministic intent before creating any book. Retrying a
    // failed branch finishes the same destination instead of making copies.
    const intent = (state.branchIntent ??= {identity, chatIntegrity: integrity, mapping, newId, newSource, mode: branchMode, books: projected.books, oldId: state.storyId, oldSource, parent, split: legacySharedBranch ? null : (w.h.context().chat?.length ?? 0) - 1});
    if (intent.identity !== identity && !(renamed && intent.identity === previous)) {
        throw new Error('Return to the chat with the unfinished branch setup before continuing.');
    }
    intent.identity = identity;
    intent.chatIntegrity ||= integrity;
    await w.persist();
    for (const [old, d] of Object.entries(intent.books)) {
        const name = intent.mapping[old];
        if (!w.h.context().getWorldInfoNames().includes(name)) await w.h.createBook(name);
        const current = await w.h.load(name);
        if (Object.keys(current?.entries || {}).length && M.bookHash(current) !== M.bookHash(d)) throw new Error(`The pending branch book "${name}" was edited. Keep it and resolve the branch setup before retrying.`);
        if (M.bookHash(current) !== M.bookHash(d)) await w.h.save(name, d);
    }
    Object.assign(mapping, intent.mapping);
    s.lorebook = mapping[oldArchive]; s.memoryBook = mapping[oldMemory] || '';
    for (const name of Object.values(mapping)) w.h.register(s.lorebook, name, name === s.lorebook ? 'archive' : 'separate');
    const ancestors = Object.fromEntries(Object.entries(state.branchBooks || {}).filter(([,previous])=>mapping[previous]).map(([original,previous])=>[original,mapping[previous]]));
    state.storyId = intent.newId; state.sourceId = intent.newSource; delete state.sharedArchive; state.parentStory = intent.oldId; state.originChat = identity; state.branchBooks = {...mapping,...ancestors}; state.chatIntegrity = integrity;
    state.branchLineage = { parent: intent.parent || parent, split: intent.split ?? null };
    const meta = w.h.meta(), chat = w.h.context().chat || [];
    meta.ranges = intent.mode === 'fresh' ? [] : (meta.ranges || []).filter(r => r.to < chat.length && r.source?.ranges?.length && M.checkSource(r.source, intent.oldSource, chat).valid).map(r => ({...r, source: {...r.source, chatId: intent.newSource, actualChatId: identity}}));
    meta.archivedThrough = Core.coverageThrough(meta);
    meta.lastDay = Core.managedSummary(intent.books[oldArchive]).lastDay;
    state.chatMemoryReceipts = (state.chatMemoryReceipts || []).filter(receipt => intent.mode !== 'fresh' && M.checkSource(receipt.source, intent.oldSource, chat).valid)
        .map(receipt => ({ ...receipt, source: { ...receipt.source, chatId: intent.newSource, actualChatId: identity } }));
    state.coverage = {}; state.applied = []; state.findings = []; state.followups = [];
    delete state.branchIntent;
    if (state.job && !['done', 'canceled'].includes(state.job.status)) { state.job.status = 'canceled'; state.job.error = 'Copied jobs do not resume in a different branch.'; }
    await w.h.attach(s.lorebook); await w.persist(); w.h.saveSettings();
    w.h.notify(branchMode === 'fresh' ? 'Created private books for this branch.' : `Created private books for this branch. ${projected.excluded.length} records outside verified history stayed in the original books.`, 'success');
}

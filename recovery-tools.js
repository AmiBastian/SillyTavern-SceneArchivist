import * as M from './memory-engine.js';

export const recordSources = r => [r?.source, ...(r?.supplementalSources || [])].filter(Boolean);
export const protectedRecord = e => ['locked', 'exact', 'detailed'].some(k => M.record(e)?.protection?.[k]);
export const overlaps = (a, b) => a.from <= b.to && a.to >= b.from;

/** Forget coverage only. Summary text and message visibility are independent. */
export function forgetLedgerRange(meta, index) {
    if (!Number.isInteger(index) || index < 0 || index >= (meta.ranges || []).length) throw new Error('This ledger range no longer exists. Refresh the ledger.');
    const result = M.copy(meta);
    result.ranges.splice(index, 1);
    let through = -1;
    for (const r of [...result.ranges].sort((a, b) => a.from - b.from)) {
        if (r.from > through + 1) break;
        through = Math.max(through, r.to);
    }
    result.archivedThrough = through;
    return result;
}

/** Only hash-verified history is retained by the conservative branch option. */
export function projectBranch(books, { mode = 'inherit', oldSource, sourceId, storyId, chatId, chat = [], archive, mapping }) {
    const result = M.copy(books), excluded = [], entries = Object.values(result).flatMap(b => Object.values(b.entries || {}));
    const retained = new Set(), rejected = new Set();
    const structural = new Set(['opening', 'closing', 'legend', 'epoch']);
    for (const e of entries) {
        e.sceneArchivistArchive = mapping[archive];
        const r = M.record(e);
        if (!r) { if (mode === 'prune') rejected.add(e); continue; }
        r.storyId = storyId;
        const sources = recordSources(r), direct = sources.filter(s => s.ranges?.length);
        const dependencies = M.unique([...(r.derivedFrom || []), ...(r.covers || [])]);
        let bad = false;
        for (const s of direct) {
            const verified = s.chatId === oldSource && s.ranges.every(x => Number.isInteger(x.from) && x.from >= 0 && x.to < chat.length && x.messages?.length && x.messages.every(m => m.index >= x.from && m.index <= x.to)) && M.checkSource(s, oldSource, chat).valid;
            if (verified) { s.inheritedFrom = s.actualChatId || oldSource; s.chatId = sourceId; s.actualChatId = chatId; }
            else if (mode === 'prune' || s.chatId === oldSource) bad = true;
        }
        if (bad) {
            r.status = 'stale'; r.staleReason = 'This record includes changed, later, or unverifiable branch evidence.';
            if (mode === 'prune') rejected.add(e);
        }
        if (mode === 'prune' && !direct.length && !dependencies.length && !structural.has(r.type)) rejected.add(e);
        if (!rejected.has(e) && (direct.length || structural.has(r.type))) retained.add(r.id);
    }
    if (mode === 'prune') {
        // Establish evidence from the leaves. Cycles, missing sources and mixed
        // before/after records cannot establish pre-branch history.
        let more = true;
        while (more) {
            more = false;
            for (const e of entries) {
                const r = M.record(e); if (!r || rejected.has(e)) continue;
                const deps = M.unique([...(r.derivedFrom || []), ...(r.covers || [])]);
                if (deps.length && deps.every(id => retained.has(id)) && !retained.has(r.id)) { retained.add(r.id); more = true; }
            }
        }
        for (const e of entries) {
            const r = M.record(e), deps = M.unique([...(r?.derivedFrom || []), ...(r?.covers || [])]);
            if (!r || !retained.has(r.id) || deps.some(id => !retained.has(id))) rejected.add(e);
        }
        // A derived record with direct evidence still needs every dependency.
        let moreRejected = true;
        while (moreRejected) {
            moreRejected = false;
            const lost = new Set([...rejected].map(e => M.record(e)?.id));
            for (const e of entries) if (!rejected.has(e) && [...(M.record(e)?.derivedFrom || []), ...(M.record(e)?.covers || [])].some(id => lost.has(id))) { rejected.add(e); moreRejected = true; }
        }
    } else {
        M.invalidate(entries, entries.filter(e => M.record(e)?.status === 'stale').map(e => M.record(e).id), 'A source does not belong to this branch history');
    }
    for (const [name, book] of Object.entries(result)) {
        delete book.sceneArchivistReceipts;
        for (const [key, e] of Object.entries(book.entries || {})) {
            if (mode === 'fresh' || rejected.has(e)) { excluded.push({ book: name, title: M.title(e) }); delete book.entries[key]; }
            else if (M.record(e)?.status === 'stale') { M.record(e).branchDisabledFrom ??= !!e.disable; e.disable = true; }
        }
        if (name === archive) book.sceneArchivistStory = { schema: 1, id: storyId, shared: false, books: Object.fromEntries(Object.values(mapping).map(n => [n, n === mapping[archive] ? 'archive' : 'separate'])) };
    }
    return { books: result, excluded };
}

/** Describe the actual invalid edge rather than calling everything unchecked. */
export function dependencyProblems(r, byId, deferredIds = new Set()) {
    if (r?.status !== 'current') return [];
    return M.unique([...(r.derivedFrom || []), ...(r.covers || [])]).flatMap(id => {
        const source = byId.get(id), sr = M.record(source);
        const reason = deferredIds.has(id) ? 'unchecked' : !source ? 'missing' : sr?.status === 'stale' ? 'stale' : r.derivedHashes?.[id] && M.hash(source.content) !== r.derivedHashes[id] ? 'changed' : '';
        return reason ? [{ id, title: source ? M.title(source) : id, reason }] : [];
    });
}

export function approvalMessage(blocked) {
    const reasons = { unchecked: 'was left unchecked in this review', missing: 'is missing from the story books', stale: 'needs correction or rebuilding', changed: 'changed after this result was generated', receipt: 'has an unapproved memory result' };
    return blocked.slice(0, 8).map(b => `${b.title}: ${(b.problems || []).map(p => `${p.title} ${reasons[p.reason] || p.reason}`).join('; ')}`).join('\n') + '\nCheck unchecked source results, or correct/rebuild changed or missing sources in Library. Review later keeps the prepared results; independent approved results can be saved separately.';
}

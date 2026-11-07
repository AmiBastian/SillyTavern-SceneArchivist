import { copy, now, uid, hash, record, title } from './memory-engine.js';
import { littleThings, setLittleThings } from './little-things.js';

// Compare the complete saved entry, including activation settings and protections.
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value ?? null);
export const same = (a, b) => canonical(a) === canonical(b);
export const entryChanges = (before, after) => [...new Set([...Object.keys(before?.entries || {}), ...Object.keys(after?.entries || {})])]
    .filter(key => !same(before?.entries?.[key], after?.entries?.[key]))
    .map(key => ({ key, id: record(after?.entries?.[key])?.id || record(before?.entries?.[key])?.id || key,
        title: title(after?.entries?.[key] || before?.entries?.[key] || {}), before: copy(before?.entries?.[key] ?? null), after: copy(after?.entries?.[key] ?? null) }));

function noteChanges(before, after) {
    const previous = new Map(littleThings(before).map(note => [note.id, note]));
    const next = new Map(littleThings(after).map(note => [note.id, note]));
    return [...new Set([...previous.keys(), ...next.keys()])]
        .filter(id => !same(previous.get(id), next.get(id)))
        .map(id => ({ kind: 'littleThing', key: id, id, title: (next.get(id) || previous.get(id)).text.slice(0, 100),
            before: copy(previous.get(id) ?? null), after: copy(next.get(id) ?? null) }));
}

const changeValue = (book, change) => (change.kind === 'littleThing'
    ? littleThings(book).find(note => note.id === change.key) : book?.entries?.[change.key]) ?? null;
const sameChange = (a, b) => a.book === b.book && a.key === b.key && a.kind === b.kind;

function restoreChange(book, change) {
    if (change.kind === 'littleThing') {
        const notes = littleThings(book);
        const at = notes.findIndex(note => note.id === change.key);
        if (at < 0 && change.before) notes.push(copy(change.before));
        else if (at >= 0) notes.splice(at, 1, ...(change.before ? [copy(change.before)] : []));
        setLittleThings(book, notes);
    } else if (change.before) book.entries[change.key] = copy(change.before);
    else delete book.entries[change.key];
}

export function makeJournal({ id = uid(), archive = '', chatId = '', label = 'Memory update', progress = {}, visibility = [] } = {}) {
    return { schema: 1, id, archive, chatId, label, at: now(), updated: now(), status: 'prepared', changes: [], receipts: {},
        progress: { before: copy(progress), after: copy(progress) }, visibility: copy(visibility) };
}

// Persist this intent before sending a save. A failed request can still have reached ST.
export function stageWrite(journal, book, before, after) {
    for (const change of [...entryChanges(before, after), ...noteChanges(before, after)]) {
        const existing = journal.changes.find(c => sameChange(c, { ...change, book }));
        if (existing) Object.assign(existing, { after: change.after, title: change.title, status: 'pending' });
        else journal.changes.push({ ...change, book, status: 'pending' });
    }
    const receipt = (journal.receipts[book] ??= { before: copy(before?.sceneArchivistReceipts || []) });
    receipt.after = copy(after?.sceneArchivistReceipts || []);
    journal.status = 'saving'; journal.updated = now();
    return journal;
}

export function confirmWrite(journal, book, actual) {
    const changes = journal.changes.filter(c => c.book === book && c.status === 'pending');
    if (changes.some(c => !same(changeValue(actual, c), c.after))) throw new Error(`The journal could not confirm the saved changes in "${book}".`);
    for (const change of changes) { change.status = 'saved'; change.confirmedAt = now(); }
    journal.status = 'saved'; journal.updated = now();
}

// Activation/protection and journal stamps do not change evidence. Learning, status,
// identity and source metadata do, even when an edit leaves the body unchanged.
function evidenceVersion(entry) {
    const metadata = copy(record(entry) || null);
    if (metadata) for (const key of ['revisions', 'lastContent', 'updated', 'created', 'contentHash', 'externalHash', 'protection', 'memoryReceipt', 'lastJobId', 'updatedIn', 'originChat']) delete metadata[key];
    return { content: entry?.content, metadata };
}

/** Build a fixed-point plan against all current managed books, including retained changes from this job. */
export function planUndo(journal, books) {
    const safe = [], conflicts = [], already = [];
    for (const change of journal.changes) {
        if (change.status === 'undone') continue;
        const current = changeValue(books[change.book], change);
        if (same(current, change.before)) { already.push(change); continue; }
        if (!Object.hasOwn(books, change.book)) { conflicts.push({ ...change, reason: 'The lorebook is unavailable.' }); continue; }
        if (!same(current, change.after)) { conflicts.push({ ...change, reason: 'The entry was edited after this job wrote it, including its settings or metadata.' }); continue; }
        safe.push(change);
    }
    let changed = true;
    while (changed) {
        changed = false;
        const projected = copy(books);
        for (const c of safe) restoreChange(projected[c.book], c);
        for (const c of [...safe]) {
            if (c.kind === 'littleThing') continue;
            if (conflicts.some(other => other.id === c.id)) {
                safe.splice(safe.indexOf(c), 1); conflicts.push({ ...c, reason: 'Another change to this record identity cannot be undone, so its move or related change must be kept together.' }); changed = true; continue;
            }
            const keepsIdentity = record(c.before)?.id === c.id;
            const sameContent = same(c.before?.content, c.after?.content), sameVersion = same(evidenceVersion(c.before), evidenceVersion(c.after));
            const receiptChanged = !same(record(c.before)?.memoryReceipt, record(c.after)?.memoryReceipt);
            if (sameVersion && c.before && keepsIdentity && !receiptChanged) continue;
            const dependents = [];
            for (const [book, data] of Object.entries(projected)) for (const e of Object.values(data.entries || {})) {
                const r = record(e); if (!r || r.id === c.id) continue;
                if (![...(r.derivedFrom || []), ...(r.covers || [])].includes(c.id)) continue;
                const retainedJobWork = receiptChanged && journal.changes.some(other => other.id === r.id && !same(e, other.before));
                if (!c.before || !keepsIdentity || retainedJobWork || (!sameVersion && sameContent && r.status === 'current') || (!sameContent && (!r.derivedHashes?.[c.id] || r.derivedHashes[c.id] !== hash(c.before.content)))) dependents.push(`${title(e)} (${book})`);
            }
            if (dependents.length) {
                safe.splice(safe.indexOf(c), 1); conflicts.push({ ...c, reason: `Retained dependent records need this version: ${dependents.join('; ')}`, dependents }); changed = true;
            }
        }
    }
    return { journal, safe, conflicts, already, complete: conflicts.length === 0 };
}

export function applyUndo(books, plan) {
    const result = copy(books);
    for (const c of plan.safe) {
        if (!same(changeValue(result[c.book], c), c.after)) throw new Error(`"${c.title}" changed after the Undo preview. Reopen Undo.`);
        restoreChange(result[c.book], c);
    }
    if (plan.complete) for (const [book, receipt] of Object.entries(plan.journal.receipts || {})) {
        if (!result[book]) continue;
        const added = (receipt.after || []).filter(id => !receipt.before.includes(id));
        result[book].sceneArchivistReceipts = (result[book].sceneArchivistReceipts || []).filter(id => !added.includes(id));
    }
    return result;
}

export function confirmUndo(journal, book, actual, plan) {
    for (const c of [...plan.safe, ...plan.already].filter(c => c.book === book)) {
        if (!same(changeValue(actual, c), c.before)) throw new Error(`Undo of "${c.title}" was not confirmed.`);
        c.status = 'undone'; c.undoneAt = now();
        const stored = journal.changes.find(x => sameChange(x, c));
        Object.assign(stored, { status: 'undone', undoneAt: c.undoneAt });
    }
    journal.status = journal.changes.every(c => c.status === 'undone') ? 'entries undone' : 'partially undone'; journal.updated = now();
}

// Read-only author search of current-chat passages with complete, matching receipts.
import * as M from './memory-engine.js';
import { mergeEvidenceRankings, recallQueries } from './memory-retrieval.js';

export const SOURCE_LIMITS = Object.freeze({ records: 1000, receipts: 2000, messages: 4000, characters: 1000000, passageMessages: 5 });
const excludedTypes = new Set(['opening', 'closing', 'legend', 'diary', 'state', 'tracker', 'epoch']);
const automaticRevisions = new Set(['Archive update', 'New character memories', 'Shorten entry', 'Organize whole character memory list',
    'Tidy layout', 'Tidy layout and remove exact duplicates', 'Bulk protection update', 'Pinned story thread', 'Unpinned story thread']);
const recordSources = record => [record?.source, ...(Array.isArray(record?.supplementalSources) ? record.supplementalSources : [])]
    .filter(source => source && typeof source === 'object');
const ranges = source => Array.isArray(source?.ranges) ? source.ranges : [];

export function correctedSource(entry) {
    const r = M.record(entry);
    return !!(r?.authorCorrections?.length || r?.authorCorrections && !Array.isArray(r.authorCorrections) || r?.externalHash
        || r?.contentHash && r.contentHash !== M.hash(entry.content)
        || r?.revisions && !Array.isArray(r.revisions) || r?.revisions?.some(revision =>
            !revision || revision.content !== entry.content && !automaticRevisions.has(revision.reason)));
}

/** Partial, foreign, changed, reordered and duplicated receipts cannot establish a scene. */
export function verifiedRange(range, source, sourceId, chat) {
    return !!sourceId && source?.chatId === sourceId && Number.isInteger(range?.from) && Number.isInteger(range?.to)
        && range.from >= 0 && range.to >= range.from && range.to < chat.length
        && Array.isArray(range.messages) && range.messages.length === range.to - range.from + 1
        && range.messages.every((message, offset) => message?.index === range.from + offset && typeof message.hash === 'string'
            && chat[message.index] && message.hash === M.messageHash(chat[message.index]));
}

export function originalCurrent(row, sourceId, chat) {
    const source = row.original?.source;
    return !!source && Array.isArray(source.ranges) && source.ranges.length > 0 && source.ranges.every(range => verifiedRange(range, source, sourceId, chat)
        && range.messages.every(message => !chat[message.index].is_system)
        && recordSources(M.record(row.parent)).some(parentSource => parentSource.chatId === sourceId && ranges(parentSource).some(parentRange =>
            parentRange?.from <= range.from && parentRange.to >= range.to && verifiedRange(parentRange, parentSource, sourceId, chat))));
}

/** No other chat is loaded. Bounds limit local work as well as supplied evidence. */
export function originalScenes(entries, { chat = [], sourceId, storyId, scopeReason = () => '', limits = SOURCE_LIMITS } = {}) {
    const rows = [], seen = new Set(), blocked = new Set();
    const report = { records: 0, receipts: 0, messages: 0, characters: 0, invalid: 0, corrected: 0, limited: false };
    const parents = [], corrected = new Set();
    // A corrected record vetoes overlapping original text even if another
    // uncorrected record still carries a receipt for that same passage.
    let checkedMessages = 0, checkedReceipts = 0, checkedCharacters = 0;
    for (const parent of entries) {
        const r = M.record(parent);
        if (r?.storyId !== storyId) continue;
        const sources = recordSources(r).filter(source => ranges(source).length);
        if (!sources.length) continue;
        const current = sources.filter(source => source.chatId === sourceId);
        if (M.active(parent) && !parent.disable && !excludedTypes.has(r.type) && !scopeReason(parent)) {
            report.invalid += sources.filter(source => source.chatId !== sourceId).reduce((sum, source) => sum + ranges(source).length, 0);
            if (current.length) parents.push({ parent, sources: current });
        }
        if (!current.length || !correctedSource(parent)) continue;
        corrected.add(parent);
        for (const source of current) for (const range of ranges(source)) {
            checkedReceipts++;
            if (checkedReceipts > limits.receipts) return { rows, report: { ...report, limited: true } };
            if (!Array.isArray(range?.messages)) continue;
            checkedMessages += range.messages.length;
            if (checkedMessages > limits.messages) return { rows, report: { ...report, limited: true } };
            checkedCharacters += range.messages.reduce((sum, message) => sum + String(chat[message?.index]?.mes || '').length + String(chat[message?.index]?.name || '').length, 0);
            if (checkedCharacters > limits.characters) return { rows, report: { ...report, limited: true } };
            for (const message of range.messages) if (Number.isInteger(message?.index) && chat[message.index] && message.hash === M.messageHash(chat[message.index])) blocked.add(message.index);
        }
    }
    outer: for (const { parent, sources } of parents) {
        let counted = false;
        for (const source of sources) for (const range of ranges(source)) {
            if (!Array.isArray(range?.messages)) { report.invalid++; continue; }
            if (range.messages.length > limits.messages) { report.limited = true; continue; }
            const signature = M.hash([sourceId, range.from, range.to, range.messages]);
            if (seen.has(signature)) continue;
            if (!counted) {
                if (report.records >= limits.records) { report.limited = true; break outer; }
                report.records++; counted = true;
            }
            if (report.receipts >= limits.receipts) { report.limited = true; break outer; }
            report.receipts++;
            seen.add(signature);
            const size = range.messages.reduce((total, message) => total + String(chat[message?.index]?.mes || '').length + String(chat[message?.index]?.name || '').length, 0);
            if (report.messages + range.messages.length > limits.messages || report.characters + size > limits.characters) {
                report.limited = true; continue;
            }
            report.messages += range.messages.length; report.characters += size;
            if (!verifiedRange(range, source, sourceId, chat)) { report.invalid++; continue; }
            if (corrected.has(parent) || range.messages.some(message => blocked.has(message.index))) { report.corrected++; continue; }
            // Adjacent chunks overlap by two whole messages to retain an exchange
            // near a boundary. Ranking removes overlaps before budget packing.
            for (let start = range.from; start <= range.to; start += Math.max(1, limits.passageMessages - 2)) {
                const end = Math.min(range.to, start + limits.passageMessages - 1);
                const messages = range.messages.slice(start - range.from, end - range.from + 1);
                if (messages.some(message => chat[message.index].is_system)) continue;
                const content = messages.map(message => {
                    const current = chat[message.index];
                    return `[#${message.index}] ${current.is_user ? 'User' : 'Character'} ${current.name || 'Unnamed'}:\n${String(current.mes || '')}`;
                }).join('\n\n');
                const receipt = { chatId: sourceId, ranges: [{ from: start, to: end, messages: M.copy(messages) }] };
                const id = 'original-' + M.hash([sourceId, messages]).replace(':', '-');
                const entry = { content, key: [], sceneArchivist: {
                    ...M.record(parent), id, type: 'clip', source: receipt, covers: [], derivedFrom: [],
                    ...M.chronology(content), people: [], locations: [], subject: '', aliases: [],
                    contentHash: M.hash(content), lastContent: content,
                } };
                rows.push({ entry, parent, excerpt: null, original: { from: start, to: end, source: receipt, parentHash: M.hash(parent.content) } });
                if (end === range.to) break;
            }
        }
    }
    return { rows, report };
}

export function searchOriginalScenes(rows, query, alternatives = []) {
    const byId = new Map(rows.map(row => [M.record(row.entry).id, row]));
    const queries = M.unique([String(query), ...recallQueries(alternatives)]);
    const rankings = queries.map(value => M.search(rows.map(row => row.entry), value)
        .map(hit => ({ ...byId.get(M.record(hit.entry).id), ...hit, queries: [value] })));
    const ranked = mergeEvidenceRankings(...rankings), accepted = [], covered = new Set();
    for (const row of ranked) {
        const messages = row.original.source.ranges[0].messages;
        if (messages.some(message => covered.has(message.index))) continue;
        accepted.push(row); messages.forEach(message => covered.add(message.index));
    }
    return accepted;
}

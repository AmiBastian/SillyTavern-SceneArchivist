import * as M from './memory-engine.js';
import { same } from './entry-journal.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sourceChat = e => M.record(e)?.source?.actualChatId || M.record(e)?.originChat || '';
export const sourceLabel = e => M.record(e)?.source?.label || sourceChat(e) || 'Legacy / unknown chat';
export const calendarDay = M.calendarDay;
export function filterEntries(entries, filters = {}) {
    return entries.filter(e => {
        const r = M.record(e); if (!r) return false;
        if (filters.chat === 'unknown' ? !!sourceChat(e) : filters.chat && sourceChat(e) !== filters.chat) return false;
        if (filters.protection && !r.protection?.[filters.protection]) return false;
        const dates = (r.dates || []).map(calendarDay).filter(Boolean);
        if (filters.dateFrom && !dates.some(d => d >= filters.dateFrom)) return false;
        if (filters.dateTo && !dates.some(d => d <= filters.dateTo)) return false;
        return true;
    });
}

/** Bounded line comparison keeps a large memory list from freezing the review. */
export function lineDiff(before, after) {
    const a = String(before || '').split('\n'), b = String(after || '').split('\n');
    let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0; while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    const old = a.slice(prefix, a.length - suffix), fresh = b.slice(prefix, b.length - suffix), out = a.slice(0, prefix).map(text => ({ kind: 'same', text }));
    if (old.length * fresh.length > 250000) out.push(...old.map(text => ({ kind: 'remove', text })), ...fresh.map(text => ({ kind: 'add', text })));
    else {
        const grid = Array.from({ length: old.length + 1 }, () => new Uint32Array(fresh.length + 1));
        for (let i = old.length - 1; i >= 0; i--) for (let j = fresh.length - 1; j >= 0; j--) grid[i][j] = old[i] === fresh[j] ? grid[i + 1][j + 1] + 1 : Math.max(grid[i + 1][j], grid[i][j + 1]);
        let i = 0, j = 0;
        while (i < old.length || j < fresh.length) {
            if (i < old.length && j < fresh.length && old[i] === fresh[j]) { out.push({ kind: 'same', text: old[i++] }); j++; }
            else if (i < old.length && (j === fresh.length || grid[i + 1][j] >= grid[i][j + 1])) out.push({ kind: 'remove', text: old[i++] });
            else out.push({ kind: 'add', text: fresh[j++] });
        }
    }
    out.push(...a.slice(a.length - suffix).map(text => ({ kind: 'same', text })));
    return out;
}
export const diffHtml = (before, after) => lineDiff(before, after).map(line => `<div class="sa-diff-${line.kind}"><span aria-hidden="true">${{ add: '+', remove: '-', same: ' ' }[line.kind]}</span> ${escape(line.text) || ' '}</div>`).join('');

/** Proposals may be saved only when their final dependencies are present at the recorded version. */
export function approvedChanges(changes, before, proposed) {
    const accepted = changes.filter(c => c.include !== false), deferred = changes.filter(c => c.include === false), blocked = [];
    let again = true;
    while (again) {
        again = false; const final = M.copy(before);
        for (const c of accepted) { final[c.book] ??= { entries: {} }; final[c.book].entries[c.uid] = proposed[c.book].entries[c.uid]; }
        const byId = new Map(Object.values(final).flatMap(b => Object.values(b.entries || {})).filter(M.record).map(e => [M.record(e).id, e]));
        for (const c of [...accepted]) {
            const e = proposed[c.book].entries[c.uid], r = M.record(e); if (!r) continue;
            const missing = r.status === 'current' ? [...(r.derivedFrom || []), ...(r.covers || [])].filter(id => !byId.has(id) || M.record(byId.get(id))?.status !== 'current' || (r.derivedHashes?.[id] && M.hash(byId.get(id).content) !== r.derivedHashes[id])) : [];
            if (!same(M.record(before[c.book]?.entries?.[c.uid])?.memoryReceipt, r.memoryReceipt)) {
                for (const other of changes) {
                    const child = M.record(proposed[other.book]?.entries?.[other.uid]);
                    if (child?.type === 'memory' && child.derivedFrom?.includes(r.id) && !accepted.includes(other)) missing.push(child.id);
                }
            }
            if (missing.length) { accepted.splice(accepted.indexOf(c), 1); deferred.push(c); blocked.push({ title: M.title(e), ids: missing }); again = true; }
        }
    }
    return { accepted, deferred, blocked };
}

export function entrySettings(e) {
    if (!e) return null;
    const r = M.record(e);
    return { keys: e.key || [], secondaryKeys: e.keysecondary || [], constant: !!e.constant, disabled: !!e.disable,
        vectorized: !!e.vectorized, position: e.position, depth: e.depth, role: e.role,
        status: r?.status, subject: r?.subject, aliases: r?.aliases, protections: r?.protection,
        memoryReceipt: r?.memoryReceipt, learnedAt: r?.learnedAt, covers: r?.covers, derivedFrom: r?.derivedFrom };
}

export function repairOrder(entries, roots) {
    const all = new Map(entries.filter(M.record).map(e => [M.record(e).id, e])), affected = new Set(roots), selected = new Set();
    let more = true;
    while (more) { more = false; for (const [id, e] of all) if (!affected.has(id) && [...(M.record(e).derivedFrom || []), ...(M.record(e).covers || [])].some(x => affected.has(x))) { affected.add(id); more = true; } }
    for (const id of affected) if (all.has(id) && ['current', 'stale'].includes(M.record(all.get(id)).status) && (M.record(all.get(id)).status === 'stale' || !roots.includes(id))) selected.add(id);
    const ordered = [], visiting = new Set(), visited = new Set();
    const visit = id => {
        if (visited.has(id)) return;
        if (visiting.has(id)) throw new Error('These records contain a circular dependency. Correct their sources before rebuilding.');
        visiting.add(id); const r = M.record(all.get(id));
        for (const dep of [...(r.derivedFrom || []), ...(r.covers || [])]) if (selected.has(dep)) visit(dep);
        visiting.delete(id); visited.add(id); ordered.push(all.get(id));
    };
    for (const id of selected) visit(id);
    return ordered;
}

/** Editing history is not fictional history. Preserve a dated transition only at the author's request. */
export function preserveKnowledge(entry, patch) {
    const r = M.record(entry), from = calendarDay(r?.learnedAt), until = calendarDay(patch.learnedAt);
    if (!['memory', 'knowledge'].includes(r?.type) || !from || !until || until <= from) throw new Error('Preserving past knowledge needs an earlier learning date and a later new learning date, both including the year.');
    return [...(r.knowledgeHistory || []), { content: entry.content, subject: r.subject, aliases: M.copy(r.aliases || []),
        learnedAt: r.learnedAt, until, howLearned: r.howLearned, knowledge: r.knowledge,
        source: M.copy(r.source), derivedHashes: M.copy(r.derivedHashes || {}), preserved: M.now() }];
}
export function knowledgeAt(entries, subject, date) {
    const cutoff = calendarDay(date); if (!cutoff) throw new Error('Choose a full calendar date, including its year.');
    const known = [], unknown = [], byId = new Map(entries.filter(M.record).map(e => [M.record(e).id, e]));
    for (const e of entries) {
        const r = M.record(e); if (!r || !['memory', 'knowledge'].includes(r.type) || ['superseded', 'resolved'].includes(r.status) || ![r.subject, ...(r.aliases || [])].some(n => String(n || '').toLocaleLowerCase() === subject.toLocaleLowerCase())) continue;
        if (r.status !== 'current') { unknown.push(e); continue; }
        const versions = [...(r.knowledgeHistory || []), { ...r, content: e.content }];
        const proven = v => Object.entries(v.derivedHashes || {}).every(([id, hash]) => byId.has(id) && M.record(byId.get(id)).status === 'current' && M.hash(byId.get(id).content) === hash);
        const candidates = versions.map(v => ({ ...v, learned: calendarDay(v.learnedAt) }))
            .filter(v => v.learned && v.learned <= cutoff && (!v.until || (calendarDay(v.until) && cutoff < calendarDay(v.until))) && proven(v))
            .sort((a, b) => b.learned.localeCompare(a.learned));
        if (candidates.length) known.push({ entry: e, version: candidates[0] });
        else if (!calendarDay(r.learnedAt) || !proven(r)) unknown.push(e);
    }
    return { known, unknown, cutoff };
}

export function selectionExport(entries, selected, includeSources = false) {
    const ids = new Set(selected), byId = new Map(entries.filter(M.record).map(e => [M.record(e).id, e]));
    if (includeSources) {
        let more = true;
        while (more) { more = false; for (const id of [...ids]) for (const dep of [...(M.record(byId.get(id))?.derivedFrom || []), ...(M.record(byId.get(id))?.covers || [])]) if (!ids.has(dep)) { ids.add(dep); more = true; } }
    }
    const records = [...ids].map(id => byId.get(id)).filter(Boolean);
    if (!records.length) throw new Error('Select records in Library first.');
    return { sceneArchivistSelection: 1, version: '1.0.5', created: M.now(), includesSources: includeSources, entries: M.copy(records),
        markdown: records.map(e => `${e.content}\n\n<!-- Record ${M.record(e).id}; source: ${sourceLabel(e)} -->`).join('\n\n---\n\n') };
}

export function proposalKey(c) { return `${c.book || ''}:${c.uid ?? c.id ?? c.title ?? ''}`; }
export function validateSharedUnits(data, proposed) {
    if (!data?.sceneArchivistStory?.shared) return;
    const numbers = new Set(Object.values(data.entries || {}).filter(e => M.record(e)?.type === 'unit' && M.record(e).unit?.number != null).map(e => M.record(e).unit.number));
    const highest = Math.max(0, ...numbers);
    for (const e of proposed) if (e.kind === 'day' && e.dayNum != null) {
        if (e.dayNum <= highest || numbers.has(e.dayNum)) throw new Error(`This shared archive already reaches unit ${highest}. New units must continue at ${highest + 1}; review the prepared output or restart with the current archive. Earlier events need retrospective entries.`);
        numbers.add(e.dayNum);
    }
}
export function summarizeJob(kind, steps, entries, archive, limit = 0) {
    const byId = new Map(entries.filter(M.record).map(e => [M.record(e).id, e]));
    const input = steps.reduce((n, p) => n + (p.ids || []).reduce((t, id) => t + M.tokens(byId.get(id)?.content || ''), 0) + (p.messages || []).reduce((t, m) => t + M.tokens(m.text || m.mes || ''), 0), 0);
    return { kind, batches: steps.length, input, archive, limit, dynamic: kind === 'archive' || kind === 'memories' };
}

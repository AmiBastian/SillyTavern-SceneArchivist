// Read-only evidence views. Stored lorebook records and their source receipts stay intact.
import * as M from './memory-engine.js';
import { parseMemoryDoc, UNITS } from './core.js';
import { memoryEvidenceIndex } from './memory-provenance.js';

export const MAX_ASK_CANDIDATES = 100;
export const MAX_RECALL_QUERIES = 3;

/** Search rewrites are search hints, never additional evidence. */
export function recallQueries(values) {
    return M.unique((Array.isArray(values) ? values : []).filter(value => typeof value === 'string')
        .map(value => value.trim().slice(0, 200)).filter(value => M.queryTerms(value).length)).slice(0, MAX_RECALL_QUERIES);
}

/** Independent searches keep a route into the shortlist even without shared words. */
export function mergeEvidenceRankings(...rankings) {
    const byId = new Map();
    for (const ranking of rankings) {
        const seen = new Set();
        ranking.slice(0, MAX_ASK_CANDIDATES).forEach((row, position) => {
            const id = M.record(row.entry).id;
            if (seen.has(id)) return;
            seen.add(id);
            const previous = byId.get(id);
            byId.set(id, { ...row, score: (previous?.score || 0) + 1 / (60 + position + 1),
                matchedTerms: M.unique([...(previous?.matchedTerms || []), ...(row.matchedTerms || [])]),
                queries: M.unique([...(previous?.queries || []), ...(row.queries || [])]) });
        });
    }
    return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, MAX_ASK_CANDIDATES);
}

/** Recognize list boundaries without flattening continuations or nested bullets. */
export function memoryBlocks(content) {
    const lines = String(content ?? '').split('\n');
    const blocks = [];
    let header = null, group = null, groupUsed = true, start = null;
    const finish = end => {
        if (start == null) return;
        while (end > start && !lines[end].trim()) end--;
        blocks.push({ start, end, context: [header, group].filter(index => index != null) });
        start = null;
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (!line.trim()) continue;
        // Fenced code and unknown global prose can change a bullet's meaning.
        // Keep these documents whole instead of silently losing that context.
        if (/^\s*(?:```|~~~)/.test(line)) return [];
        if (/^## ► Memories\s+[—–-]\s+\S/.test(line)) {
            if (header != null || blocks.length || start != null || group != null) return [];
            header = i;
        } else if (line.startsWith('[') && line.endsWith(']')) {
            const [item] = parseMemoryDoc(line + '\n- boundary probe');
            if (!item || (item.a == null && !item.date) || !groupUsed) return [];
            finish(i - 1);
            group = i; groupUsed = false;
        } else if (/^[-*] \S/.test(line)) {
            finish(i - 1);
            start = i; groupUsed = true;
        } else if (!/^\s/.test(line) || start == null) {
            return [];
        }
    }
    finish(lines.length - 1);
    return groupUsed && blocks.length > 1 ? blocks : [];
}

const literalMetadata = (values, words) => {
    return (values || []).filter(value => {
        const terms = M.queryTerms(value);
        return terms.length && terms.every(term => words.has(term));
    });
};

/** A bounded parse cache, never an independent source of truth or stored memory. */
export class MemoryIndex {
    constructor({ maxRecords = 128, maxCharacters = 1000000 } = {}) {
        this.maxRecords = maxRecords;
        this.maxCharacters = maxCharacters;
        this.clear();
    }

    clear() { this.cache = new Map(); this.characters = 0; }

    blocks(entry) {
        const r = M.record(entry), content = String(entry.content || '');
        const key = JSON.stringify([r.storyId, entry.world, r.id, UNITS]);
        const previous = this.cache.get(key);
        if (previous) {
            this.cache.delete(key); this.characters -= previous.content.length;
            if (previous.content === content) {
                this.cache.set(key, previous); this.characters += content.length;
                return previous.blocks;
            }
        }
        const blocks = memoryBlocks(content);
        if (this.maxRecords > 0 && content.length <= this.maxCharacters) {
            while (this.cache.size >= this.maxRecords || this.characters + content.length > this.maxCharacters) {
                const oldest = this.cache.keys().next().value;
                this.characters -= this.cache.get(oldest).content.length; this.cache.delete(oldest);
            }
            this.cache.set(key, { content, blocks }); this.characters += content.length;
        }
        return blocks;
    }

    search(entries, query, scopeReason = () => '') {
        const rows = [], fragments = new Map();
        // Scope the original record first. A derived view cannot regain access
        // to a disabled, retired, foreign-speaker, or future-dated parent.
        for (const parent of entries) {
            const r = M.record(parent);
            if (!r?.id || !M.active(parent) || parent.disable || scopeReason(parent)) continue;
            const blocks = r.type === 'memory' && !r.covers?.length ? this.blocks(parent) : [];
            if (!blocks.length) {
                rows.push({ entry: parent, parent, excerpt: null });
                continue;
            }
            const lines = String(parent.content).split('\n'), parentHash = M.hash(parent.content);
            const support = memoryEvidenceIndex(parent);
            const ids = [];
            for (const block of blocks) {
                const content = [...block.context.map(index => lines[index]), lines.slice(block.start, block.end + 1).join('\n')].join('\n\n');
                const words = new Set(M.queryTerms(content));
                const id = `${r.id}~${parentHash.replace(':', '-')}:${block.start + 1}`;
                const entry = { ...parent, content, key: literalMetadata(parent.key, words), sceneArchivist: {
                    ...r, id, ...M.chronology(content), people: literalMetadata(r.people, words), locations: literalMetadata(r.locations, words),
                    contentHash: M.hash(content), lastContent: content,
                } };
                rows.push({ entry, parent, provenance: support(content), excerpt: { fromLine: block.start + 1, toLine: block.end + 1,
                    contextLines: block.context.map(index => index + 1), parentHash } });
                ids.push(id);
            }
            fragments.set(r.id, ids);
        }
        // Keep recap/detail overlap protection when a covered list becomes
        // several evidence views. Only the derived metadata is changed.
        for (const row of rows) {
            const r = M.record(row.entry);
            if (r.covers?.some(id => fragments.has(id))) row.entry = { ...row.entry, sceneArchivist: {
                ...r, covers: M.unique(r.covers.flatMap(id => fragments.get(id) || [id])),
            } };
        }
        const byId = new Map(rows.map(row => [M.record(row.entry).id, row]));
        const ranked = M.search(rows.map(row => row.entry), query), frequencies = new Map();
        for (const hit of ranked) for (const term of hit.matchedTerms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
        return ranked.map(hit => ({ ...byId.get(M.record(hit.entry).id), ...hit,
            // A common character name must not drown out a rare topic word in
            // another list. This is lexical weighting, not semantic retrieval.
            score: hit.score + hit.matchedTerms.reduce((sum, term) => sum + 5 * Math.log1p(rows.length / frequencies.get(term)), 0),
        })).sort((a, b) => b.score - a.score);
    }

    searchMany(entries, query, alternatives = [], scopeReason = () => '') {
        const queries = recallQueries(alternatives).filter(value => value.toLocaleLowerCase() !== String(query).trim().toLocaleLowerCase());
        const primary = this.search(entries, query, scopeReason);
        if (!queries.length) return primary;
        return mergeEvidenceRankings(primary.map(row => ({ ...row, queries: [query] })), ...queries.map(value =>
            this.search(entries, value, scopeReason).map(row => ({ ...row, queries: [value] }))));
    }
}

export function evidenceText(row) {
    const location = row.original ? `Verified original messages #${row.original.from}-#${row.original.to} in the current chat; linked saved record ${M.record(row.parent).id}. Surrounding messages may be omitted.\n`
        : row.excerpt ? `Saved record ${M.record(row.parent).id}; lines ${row.excerpt.fromLine}-${row.excerpt.toLine}; heading lines ${row.excerpt.contextLines.join(', ') || 'none'}.\n` : '';
    return `SOURCE ${M.record(row.entry).id}\n${location}${row.entry.content}`;
}

export function packEvidence(rows, { budget, query, counts } = {}) {
    rows = rows.slice(0, MAX_ASK_CANDIDATES);
    const entries = rows.map(row => row.entry), selected = entries.slice(0, 30).map(entry => M.record(entry).id);
    const costs = counts || Object.fromEntries(rows.map(row => [M.record(row.entry).id, M.tokens(evidenceText(row) + '\n') + 4]));
    const allocation = M.allocate(entries, { budget, query, selected, counts: costs, ranked: rows,
        details: entries.slice(0, 30).filter(entry => M.record(entry).type !== 'recap').map(entry => M.record(entry).id) });
    const byId = new Map(rows.map(row => [M.record(row.entry).id, row]));
    return { ...allocation, evidence: allocation.accepted.map(item => byId.get(item.id)) };
}

/** Tools return complete evidence blocks, never an arbitrary character slice. */
export function toolEvidence(rows, limit = 4800) {
    const note = 'Some matching evidence exceeds the tool allowance. Inspect it in Scene Archivist Library.';
    const selected = [];
    let used = 0, omitted = false;
    for (const row of rows) {
        const text = evidenceText(row), cost = text.length + (selected.length ? 2 : 0);
        if (used + cost > limit - note.length - 2) { omitted = true; continue; }
        selected.push(text); used += cost;
    }
    if (omitted) selected.push(note);
    return selected.join('\n\n') || 'No matching active Scene Archivist records.';
}

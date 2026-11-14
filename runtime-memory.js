import * as M from './memory-engine.js';
import { packEvidence } from './memory-retrieval.js';

/** Narrow only copies already activated by native WI, after native recursion. */
export async function runtimeMemories(w, entries, query, budget, details = w.details, heldExcerpts = w.recallDetails) {
    if (!w.options().preciseDelivery) return entries;
    const ranked = w.memoryIndex.search(entries, query);
    const byParent = new Map();
    const linesByParent = new Map(), queryWords = M.queryTerms(query);
    for (const row of ranked) {
        if (!row.excerpt) continue;
        const id = M.record(row.parent).id;
        if (!linesByParent.has(id)) linesByParent.set(id, String(row.parent.content).split('\n'));
        const lines = linesByParent.get(id);
        const context = new Set(M.queryTerms(row.excerpt.contextLines.map(line => lines[line - 1]).join('\n')));
        const topic = queryWords.filter(word => !context.has(word));
        const body = new Set(M.queryTerms(lines.slice(row.excerpt.fromLine - 1, row.excerpt.toLine).join('\n')));
        if (!topic.some(word => body.has(word))) continue; // Names/date headers alone cannot select arbitrary bullets.
        if (!byParent.has(id)) byParent.set(id, []);
        byParent.get(id).push(row);
    }
    const candidates = entries.map(parent => {
        const r = M.record(parent);
        if (details.has(r.id) || ['exact', 'locked', 'detailed'].some(flag => r.protection?.[flag])) return { parent, rows: [] };
        const held = (heldExcerpts?.get(r.id) || []).filter(row => row.excerpt?.parentHash === M.hash(parent.content));
        return { parent, rows: (held.length ? held : byParent.get(r.id) || []).slice(0, 8) };
    });
    const counts = await w.countEntries(candidates.flatMap(item => item.rows.map(row => row.entry)));
    return candidates.map(({ parent, rows }) => {
        if (!rows.length) return parent; // A semantic-only match keeps its full native record.
        const packed = packEvidence(rows, { budget, query, counts });
        if (!packed.evidence.length) return parent;
        const content = packed.evidence.map(row => row.entry.content).join('\n\n');
        return { ...parent, content, sceneArchivistDelivery: {
            parentHash: M.hash(parent.content), excerpts: packed.evidence.map(row => ({ id: M.record(row.entry).id,
                fromLine: row.excerpt.fromLine, toLine: row.excerpt.toLine, contextLines: row.excerpt.contextLines })),
        } };
    });
}

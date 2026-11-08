import * as M from './memory-engine.js';

export const referenceText = item => `[Reference: ${item.book} / ${item.title || item.uid}]\n${item.text}`;

export async function readReferenceEntries(selections, load) {
    const grouped = new Map();
    for (const item of selections || []) {
        if (!grouped.has(item.book)) grouped.set(item.book, []);
        grouped.get(item.book).push(item);
    }
    const result = [];
    for (const [book, items] of grouped) {
        const data = await load(book);
        if (!data) throw new Error(`Reference lorebook "${book}" is unavailable. Update the selection before running.`);
        const entries = Object.values(data.entries || {});
        if (items.some(item => item.uid != null && !entries.some(entry => String(entry.uid) === String(item.uid)))) throw new Error(`A selected entry in "${book}" was removed. Update the reference selection.`);
        for (const entry of entries) if (entry.content && items.some(item => item.uid == null || String(item.uid) === String(entry.uid))) {
            result.push({ book, uid: entry.uid, title: entry.comment || String(entry.uid), text: String(entry.content) });
        }
    }
    return result;
}

/** Only an explicit fit policy may omit references. Never cut an entry's text. */
export async function fitReferences(items, { budget = 0, policy = 'all', query = '', count } = {}) {
    const counts = await Promise.all(items.map(async item => {
        try { const actual = Number(await count?.(referenceText(item))); if (Number.isFinite(actual) && actual > 0) return actual + 4; } catch { /* estimate */ }
        return M.tokens(referenceText(item)) + 4;
    }));
    const total = counts.reduce((sum, n) => sum + n, 0), cap = Math.max(0, Number(budget) || 0);
    const entries = items.map((item, index) => ({ content: referenceText(item), key: [item.title], sceneArchivist: { id: String(index), type: 'fact', status: 'current' } }));
    const order = policy === 'relevant' ? M.unique([...M.search(entries, String(query).slice(0, 12000)).map(row => M.record(row.entry).id), ...entries.map(entry => M.record(entry).id)]).map(Number) : items.map((_, index) => index);
    if (cap && total > cap && policy !== 'relevant') throw new Error(`Selected reference lorebooks need about ${total.toLocaleString()} tokens; their separate allowance is ${cap.toLocaleString()}. Trim the selection or choose relevant complete entries in Settings.`);
    let used = 0;
    const selected = [], omitted = [];
    for (const index of order) {
        const item = { ...items[index], tokens: counts[index] };
        if (cap && used + counts[index] > cap) omitted.push(item);
        else { selected.push(item); used += counts[index]; }
    }
    return { text: selected.map(referenceText).join('\n\n'), selected, omitted, tokens: used, total, budget: cap, policy };
}

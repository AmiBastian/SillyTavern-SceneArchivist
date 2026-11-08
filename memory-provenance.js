import * as M from './memory-engine.js';
import * as Core from './core.js';

const normalized = text => String(text).replace(/\s+/g, ' ').trim();
const parsedBullet = text => Core.parseMemoryDoc('- ' + normalized(text))[0];

/** A model's citation is checked against the actual supplied selection, not invented. */
export function memoryEvidence(raw, { source, inputs = [], dateMap = {} } = {}) {
    const output = typeof raw === 'string' ? M.parseJSON(raw) : raw;
    const allowed = new Map((source?.ranges || []).flatMap(range => range.messages || []).map(message => [message.index, message]));
    const ids = new Set(inputs.map(entry => M.record(entry)?.id));
    const result = [];
    for (const character of output?.characters || []) for (const item of character.memories || []) {
        if (typeof item === 'string') continue; // Legacy strings have no per-bullet claim.
        if (!item || typeof item.text !== 'string' || !Array.isArray(item.messages) || !Array.isArray(item.sourceIds)
            || item.messages.some(index => !Number.isInteger(index) || !allowed.has(index)) || item.sourceIds.some(id => !ids.has(id))) {
            throw new Error('A memory cited messages or archive records outside the selected evidence.');
        }
        const bullet = parsedBullet(item.text);
        if (!bullet) throw new Error('A memory did not contain usable text.');
        const indices = [...new Set(item.messages)].sort((a, b) => a - b);
        const ranges = indices.map(index => ({ from: index, to: index, messages: [M.copy(allowed.get(index))] }));
        result.push({ character: String(character.name), text: bullet.text, textHash: M.hash(normalized(bullet.text)),
            a: bullet.a, b: bullet.b, date: bullet.date || dateMap[bullet.a] || '',
            ...(ranges.length ? { source: { chatId: source.chatId, ...(source.actualChatId ? { actualChatId: source.actualChatId } : {}), ranges } } : {}),
            sourceIds: M.unique(item.sourceIds), learnedAt: typeof item.learnedAt === 'string' ? item.learnedAt.slice(0, 120) : '',
            howLearned: typeof item.howLearned === 'string' ? item.howLearned.slice(0, 200) : '', citation: 'model-cited, selection-checked' });
    }
    return result;
}

export function mergeMemoryEvidence(entry, proposed, names) {
    const r = M.record(entry), accepted = new Set(names.map(name => String(name).toLocaleLowerCase()));
    const records = [...(Array.isArray(r.memoryEvidence) ? r.memoryEvidence : []), ...(proposed || []).filter(item => accepted.has(item.character.toLocaleLowerCase()))];
    r.memoryEvidence = [...new Map(records.map(item => [M.hash(item), M.copy(item)])).values()];
}

/** Match exact current saved text; ambiguous duplicates never inherit a receipt. */
export function memoryEvidenceIndex(parent) {
    const records = M.record(parent).memoryEvidence;
    if (!Array.isArray(records) || !records.length) return () => [];
    const key = item => JSON.stringify([item.textHash || M.hash(normalized(item.text)), item.a, item.b, item.date]);
    const counts = new Map(), evidence = new Map();
    for (const item of Core.parseMemoryDoc(parent.content)) counts.set(key(item), (counts.get(key(item)) || 0) + 1);
    for (const item of records.filter(item => item?.textHash)) evidence.set(key(item), [...(evidence.get(key(item)) || []), item]);
    return content => {
        const items = Core.parseMemoryDoc(content), bullet = items.length === 1 ? items[0] : null;
        return bullet && counts.get(key(bullet)) === 1 ? evidence.get(key(bullet)) || [] : [];
    };
}
export const bulletEvidence = (parent, content) => memoryEvidenceIndex(parent)(content);

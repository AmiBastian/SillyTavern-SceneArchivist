import * as M from './memory-engine.js';
import * as Core from './core.js';

const normalized = text => String(text).replace(/\s+/g, ' ').trim();
const parsedBullet = text => Core.parseMemoryDoc('- ' + normalized(text))[0];
const bulletKey = item => JSON.stringify([item.textHash || M.hash(normalized(item.text)), item.a, item.b, item.date]);

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

function savedEvidence(parent) {
    const records = M.record(parent).memoryEvidence;
    if (!Array.isArray(records) || !records.length) return () => [];
    const counts = new Map(), evidence = new Map();
    for (const item of Core.parseMemoryDoc(parent.content)) counts.set(bulletKey(item), (counts.get(bulletKey(item)) || 0) + 1);
    for (const item of records.filter(item => item?.textHash)) evidence.set(bulletKey(item), [...(evidence.get(bulletKey(item)) || []), item]);
    return item => counts.get(bulletKey(item)) === 1 ? evidence.get(bulletKey(item)) || [] : [];
}

/** Match exact current saved text; ambiguous duplicates never inherit a receipt. */
export function memoryEvidenceIndex(parent) {
    const evidence = savedEvidence(parent);
    return content => {
        const items = Core.parseMemoryDoc(content), bullet = items.length === 1 ? items[0] : null;
        return bullet ? evidence(bullet) : [];
    };
}
export const bulletEvidence = (parent, content) => memoryEvidenceIndex(parent)(content);

export function memoryRewriteSources(parent, content = parent.content) {
    if (!M.record(parent)?.memoryEvidence?.length) return new Map();
    const lookup = savedEvidence(parent);
    return new Map(Core.parseMemoryDoc(content).flatMap((bullet, i) => {
        const evidence = lookup(bullet);
        return evidence.length ? [[i + 1, { bullet, evidence }]] : [];
    }));
}

export const memoryLinkInstructions = 'When rewriting a cited memory, include a memoryLinks array on its result with {"bullet":1,"sources":[2,4]} items. Bullet is the one-based position in the resulting memory list. Sources are the one-based positions of the original memory bullets supplied for that same list. Use only the listed positions. Include every original source that supports a merged bullet. An unchanged dated bullet retains its links.';
export const memorySourcePositions = sources => `Cited source bullet positions (starting at 1): ${[...sources.keys()].join(', ')}.`;
export const memoryEvidenceWarning = result => result.missingEvidence ? `${result.missingEvidence} original memory ${result.missingEvidence === 1 ? 'bullet has' : 'bullets have'} no source link in this proposal. The previous text and links stay in revisions.` : '';
export const memoryEvidencePatch = result => result.memoryEvidence ? { memoryEvidence: result.memoryEvidence } : {};

/** Keep links from exact matches and validate explicit rewrite links against the supplied list. */
export function memoryRewriteEvidence(sources, bullets, links) {
    if (!sources?.size) return {};
    const byText = new Map([...sources].map(([id, source]) => [bulletKey(source.bullet), id]));
    const mapped = new Map(), used = new Set(), evidence = new Map(), counts = new Map();
    for (const bullet of bullets) counts.set(bulletKey(bullet), (counts.get(bulletKey(bullet)) || 0) + 1);
    if (links != null) {
        if (!Array.isArray(links)) throw new Error('Memory source links must be a list.');
        for (const link of links) {
            if (!Number.isInteger(link?.bullet) || link.bullet < 1 || link.bullet > bullets.length || mapped.has(link.bullet)
                || !Array.isArray(link.sources) || !link.sources.length || link.sources.some(id => !sources.has(id))) {
                throw new Error('A rewritten memory linked to a bullet outside its supplied list.');
            }
            mapped.set(link.bullet, link.sources);
        }
    }
    for (const [index, bullet] of bullets.entries()) {
        const key = bulletKey(bullet);
        if (counts.get(key) !== 1) continue;
        const sourceIds = new Set([...(mapped.get(index + 1) || []), byText.get(key)].filter(id => id != null));
        for (const id of sourceIds) {
            used.add(id);
            for (const item of sources.get(id).evidence) {
                const retained = { ...item, text: bullet.text, textHash: M.hash(normalized(bullet.text)),
                    a: bullet.a, b: bullet.b, date: bullet.date };
                evidence.set(M.hash(retained), retained);
            }
        }
    }
    return { memoryEvidence: [...evidence.values()], missingEvidence: sources.size - used.size };
}

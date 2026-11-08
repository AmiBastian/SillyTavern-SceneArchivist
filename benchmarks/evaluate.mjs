import * as M from '../memory-engine.js';

export function validateFixture(fixture) {
    if (fixture.schema !== 1 || !Array.isArray(fixture.records) || !Array.isArray(fixture.queries) || !Array.isArray(fixture.messages)) throw new Error('Unsupported benchmark fixture.');
    if (fixture.messages.some((message, index) => message.id !== index || typeof message.text !== 'string')) throw new Error('Source messages need stable contiguous indices.');
    const records = new Map(fixture.records.map(record => [record.id, record]));
    if (records.size !== fixture.records.length) throw new Error('Duplicate fixture record id.');
    if (new Set(fixture.queries.map(query => query.id)).size !== fixture.queries.length) throw new Error('Duplicate fixture query id.');
    for (const record of fixture.records) {
        if (!fixture.messages.some(message => message.id === record.sourceMessage) || typeof record.content !== 'string') throw new Error('Record needs original source evidence.');
    }
    for (const query of fixture.queries) {
        if (!query.question || !Array.isArray(query.relevant) || new Set(query.relevant).size !== query.relevant.length) throw new Error('Invalid relevance labels.');
        if (query.relevant.some(id => !records.has(id))) throw new Error('A relevance label names a missing record.');
        const support = query.relevant.map(id => records.get(id).sourceMessage);
        if (JSON.stringify(query.support) !== JSON.stringify(support) || (!!query.relevant.length !== (typeof query.answer === 'string' && !!query.answer))) throw new Error('Query answer or source support is inconsistent.');
    }
    return fixture;
}

export function buildCorpus(fixture, noise = 0) {
    validateFixture(fixture);
    const records = fixture.records.map(record => {
        const content = record.content + (record.padding ? '\n' + record.padding.text.repeat(record.padding.repeat) : '');
        const entry = { uid: record.id, comment: record.id, content, key: record.keys, probability: 100 };
        entry.sceneArchivist = M.makeRecord(entry, { type: record.type, storyId: 'benchmark', source: {
            chatId: 'benchmark', ranges: [{ from: record.sourceMessage, to: record.sourceMessage,
                messages: [{ index: record.sourceMessage, hash: M.messageHash({ name: fixture.messages[record.sourceMessage].name, mes: fixture.messages[record.sourceMessage].text }) }] }],
        } }, { id: record.id, subject: record.subject, created: '2026-11-08T00:00:00Z', updated: '2026-11-08T00:00:00Z' });
        return entry;
    });
    for (let i = 0; i < noise; i++) {
        const entry = { uid: 'noise-' + i, comment: 'Routine platform log ' + i,
            content: `Routine platform log ${i}: a crate of linen was counted in the east store.`, key: ['platform log'] };
        entry.sceneArchivist = M.makeRecord(entry, { type: 'unit', storyId: 'benchmark' }, { id: entry.uid });
        records.push(entry);
    }
    return records;
}

const rounded = value => Math.round(value * 1000000) / 1000000;
export function scoreSelection(ids, relevant) {
    if (!relevant.length) return null;
    const unique = [...new Set(ids)], hits = unique.filter(id => relevant.includes(id));
    const first = unique.findIndex(id => relevant.includes(id));
    return { hit: hits.length > 0 ? 1 : 0, recall: rounded(hits.length / relevant.length),
        precision: rounded(hits.length / (unique.length || 1)), reciprocalRank: first < 0 ? 0 : rounded(1 / (first + 1)) };
}

export function evaluateRecall(fixture, { noise = 0, budget = 2048, topK = 5 } = {}) {
    const entries = buildCorpus(fixture, noise);
    const queries = fixture.queries.map(query => {
        // Match Ask the archive's current saved-record candidate and packing path.
        // This does not simulate ST activation, semantic vectors, or an LLM answer.
        const ranked = M.search(entries, query.question).filter(hit => M.active(hit.entry));
        const selected = ranked.slice(0, 30).map(hit => M.record(hit.entry).id);
        const packed = M.allocate(ranked.map(hit => hit.entry), { budget, query: query.question, selected,
            details: selected.filter(id => M.record(entries.find(entry => M.record(entry).id === id)).type !== 'recap') });
        const candidates = ranked.slice(0, topK).map(hit => M.record(hit.entry).id);
        const loaded = packed.accepted.slice(0, topK).map(hit => hit.id);
        return { id: query.id, relevant: query.relevant, candidates, loaded, tokens: packed.used,
            candidateScore: scoreSelection(candidates, query.relevant), loadedScore: scoreSelection(loaded, query.relevant) };
    });
    const known = queries.filter(query => query.relevant.length);
    const summarize = key => Object.fromEntries(['hit', 'recall', 'precision', 'reciprocalRank']
        .map(metric => [metric, rounded(known.reduce((sum, query) => sum + query[key][metric], 0) / (known.length || 1))]));
    return { noise, records: entries.length, budget, topK, knownQuestions: known.length,
        unknownQuestions: queries.length - known.length, candidate: summarize('candidateScore'), loaded: summarize('loadedScore'),
        unknownWithCandidates: queries.filter(query => !query.relevant.length && query.candidates.length).length,
        queries };
}

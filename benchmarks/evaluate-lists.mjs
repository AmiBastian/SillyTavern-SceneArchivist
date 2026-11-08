import * as M from '../memory-engine.js';
import { MemoryIndex, packEvidence, MAX_ASK_CANDIDATES } from '../memory-retrieval.js';

export function validateLists(fixture) {
    if (fixture.schema !== 1 || !Array.isArray(fixture.records) || !Array.isArray(fixture.queries)) throw new Error('Unsupported memory-list fixture.');
    const recordIds = new Set(), labels = new Set(), queryIds = new Set();
    for (const record of fixture.records) {
        if (!record.id || recordIds.has(record.id) || !['list', 'prose'].includes(record.kind) || !record.subject || !record.date
            || !Number.isInteger(record.unit) || !Number.isInteger(record.routine) || record.routine < 0 || record.routine > 2000
            || !Array.isArray(record.bullets) || !record.bullets.length) throw new Error('Invalid memory-list record.');
        recordIds.add(record.id);
        for (const bullet of record.bullets) {
            if (!bullet.id || labels.has(bullet.id) || typeof bullet.text !== 'string' || !bullet.text.trim()
                || bullet.qualifier && (typeof bullet.qualifier.text !== 'string' || !Number.isInteger(bullet.qualifier.repeat) || bullet.qualifier.repeat < 0 || bullet.qualifier.repeat > 2000)) throw new Error('Invalid or duplicate evidence label.');
            labels.add(bullet.id);
        }
    }
    for (const query of fixture.queries) {
        if (!query.id || queryIds.has(query.id) || !query.question || !Array.isArray(query.relevant)
            || new Set(query.relevant).size !== query.relevant.length || query.relevant.some(id => !labels.has(id))
            || !!query.relevant.length !== (typeof query.answer === 'string' && !!query.answer)) throw new Error('Invalid memory-list query or evidence label.');
        queryIds.add(query.id);
    }
    return fixture;
}

export function buildLists(fixture, noise = 0) {
    validateLists(fixture);
    const entries = [], labels = new Map();
    for (const record of fixture.records) {
        const lines = ['## ► Memories ' + String.fromCharCode(0x2014) + ' ' + record.subject, '', `[${record.date} - Day ${record.unit}]`];
        for (let i = 0; i < record.routine; i++) lines.push(`${record.kind === 'list' ? '- ' : ''}Routine inventory ${i}: linen was counted and flour was stored by the east platform.`);
        const spans = [];
        for (const bullet of record.bullets) {
            const from = lines.length + 1;
            const text = bullet.text + (bullet.qualifier ? bullet.qualifier.text.repeat(bullet.qualifier.repeat) : '');
            lines.push(...((record.kind === 'list' ? '- ' : '') + text).split('\n'));
            spans.push({ id: bullet.id, from, to: lines.length });
        }
        const entry = { uid: record.id, content: lines.join('\n'), key: [], world: 'benchmark' };
        entry.sceneArchivist = M.makeRecord(entry, { type: 'memory', storyId: 'benchmark' }, { id: record.id, subject: record.subject,
            created: '2026-11-08T00:00:00Z', updated: '2026-11-08T00:00:00Z' });
        entries.push(entry); labels.set(record.id, spans);
    }
    for (let i = 0; i < noise; i++) {
        const entry = { uid: 'noise-' + i, content: `Routine platform log ${i}: the east store contained linen and flour.`, key: [] };
        entry.sceneArchivist = M.makeRecord(entry, { type: 'unit', storyId: 'benchmark' }, { id: entry.uid });
        entries.push(entry);
    }
    return { entries, labels };
}

const rounded = value => Math.round(value * 1000000) / 1000000;
const coverage = (rows, labels) => M.unique(rows.flatMap(row => (labels.get(M.record(row.parent).id) || [])
    .filter(span => !row.excerpt || row.excerpt.fromLine <= span.from && row.excerpt.toLine >= span.to).map(span => span.id)));
const score = (delivered, relevant) => relevant.length ? {
    hit: relevant.some(id => delivered.includes(id)) ? 1 : 0,
    recall: rounded(relevant.filter(id => delivered.includes(id)).length / relevant.length),
} : null;

export function evaluateLists(fixture, { noise = 0, budget = 2048, mode = 'excerpts', topK = 5 } = {}) {
    if (!['whole', 'excerpts'].includes(mode)) throw new Error('Unknown retrieval mode.');
    const { entries, labels } = buildLists(fixture, noise), index = new MemoryIndex();
    const queries = fixture.queries.map(query => {
        const ranked = (mode === 'excerpts' ? index.search(entries, query.question)
            : M.search(entries, query.question).filter(hit => M.active(hit.entry) && !hit.entry.disable)
                .map(hit => ({ ...hit, parent: hit.entry, excerpt: null }))).slice(0, MAX_ASK_CANDIDATES);
        // Both arms share the allocator, citation-wrapper allowance and cap.
        const packed = packEvidence(ranked, { query: query.question, budget });
        const candidates = ranked.slice(0, topK), candidateEvidence = coverage(candidates, labels), loadedEvidence = coverage(packed.evidence, labels);
        return { id: query.id, relevant: query.relevant, candidates: candidates.map(row => M.record(row.entry).id),
            loaded: packed.evidence.map(row => M.record(row.entry).id), candidateEvidence, loadedEvidence,
            tokens: packed.used, candidateScore: score(candidateEvidence, query.relevant), loadedScore: score(loadedEvidence, query.relevant) };
    });
    const known = queries.filter(query => query.relevant.length);
    const average = (key, metric) => rounded(known.reduce((sum, query) => sum + query[key][metric], 0) / (known.length || 1));
    return { mode, noise, records: entries.length, budget, topK, knownQuestions: known.length, unknownQuestions: queries.length - known.length,
        candidateHitAt5: average('candidateScore', 'hit'), loadedHit: average('loadedScore', 'hit'), loadedRecall: average('loadedScore', 'recall'),
        meanKnownTokens: rounded(known.reduce((sum, query) => sum + query.tokens, 0) / (known.length || 1)),
        unknownWithCandidates: queries.filter(query => !query.relevant.length && query.candidates.length).length,
        unknownWithLoaded: queries.filter(query => !query.relevant.length && query.loaded.length).length, queries };
}

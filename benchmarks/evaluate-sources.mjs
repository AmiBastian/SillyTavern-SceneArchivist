import * as M from '../memory-engine.js';
import { MemoryIndex, mergeEvidenceRankings, packEvidence } from '../memory-retrieval.js';
import { originalScenes, searchOriginalScenes } from '../original-scenes.js';
import { buildCorpus, scoreSelection } from './evaluate.mjs';

export function evaluateSources(fixture, rewrites, { budget = 512, noise = 0, mode = 'sources' } = {}) {
    if (!['saved', 'sources', 'scripted-rewrites'].includes(mode)) throw new Error('Unknown source comparison mode.');
    if (rewrites.schema !== 1 || !rewrites.queries || Object.entries(rewrites.queries).some(([id, values]) =>
        !fixture.queries.some(query => query.id === id) || !Array.isArray(values) || values.length > 3
            || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 200))) throw new Error('Invalid scripted rewrite fixture.');
    const entries = buildCorpus(fixture, noise), chat = fixture.messages.map(message => ({ name: message.name, mes: message.text }));
    const index = new MemoryIndex(), originals = originalScenes(entries, { chat, sourceId: 'benchmark', storyId: 'benchmark' });
    const queries = fixture.queries.map(query => {
        const alternatives = mode === 'scripted-rewrites' ? rewrites.queries[query.id] || [] : [];
        const saved = index.searchMany(entries, query.question, alternatives);
        const raw = mode === 'saved' ? [] : searchOriginalScenes(originals.rows, query.question, alternatives);
        const ranked = raw.length ? mergeEvidenceRankings(saved, raw) : saved;
        const packed = packEvidence(ranked, { query: query.question, budget });
        const covered = M.unique(packed.evidence.flatMap(row => row.original
            ? fixture.records.filter(record => row.original.source.ranges.some(range => range.messages.some(message => message.index === record.sourceMessage))).map(record => record.id)
            : [M.record(row.parent).id]));
        return { id: query.id, relevant: query.relevant, scriptedQueries: alternatives,
            loaded: packed.evidence.map(row => ({ id: M.record(row.entry).id, parent: M.record(row.parent).id,
                original: row.original ? { from: row.original.from, to: row.original.to } : null })),
            covered, tokens: packed.used, score: scoreSelection(covered, query.relevant) };
    });
    const known = queries.filter(query => query.score);
    const mean = metric => Math.round(known.reduce((sum, query) => sum + query.score[metric], 0) / known.length * 1000000) / 1000000;
    return { mode, noise, records: entries.length, budget, knownQuestions: known.length, unknownQuestions: queries.length - known.length,
        loadedHit: mean('hit'), loadedRecall: mean('recall'), unknownWithLoaded: queries.filter(query => !query.score && query.loaded.length).length,
        sourceReport: mode === 'saved' ? null : originals.report, queries };
}

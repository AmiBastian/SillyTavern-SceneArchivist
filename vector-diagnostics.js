// Observe existing native vector requests. This never makes an embedding call,
// changes a request, or consumes the Response returned to SillyTavern.
const providerNames = { palm: 'Google AI Studio', vertexai: 'Google Vertex AI', transformers: 'Local (Transformers)', openrouter: 'OpenRouter', openai: 'OpenAI', ollama: 'Ollama', webllm: 'WebLLM' };
export const providerName = source => providerNames[source] || String(source || 'configured provider');

export function newVectorRun(settings = {}) {
    return { status: settings.enabled_world_info ? 'waiting' : 'disabled', provider: providerName(settings.source),
        model: settings.google_model || '', requests: 0, searches: 0, returned: 0,
        activated: new Set(), storyMatches: new Set(), hashes: new Set(), error: '', startedAt: Date.now() };
}

function requestInfo(input, init) {
    const raw = typeof input === 'string' ? input : input?.url || String(input);
    const url = new URL(raw, 'http://sillytavern.local');
    if (!/^\/api\/vector\/(list|insert|delete|query-multi|query)$/.test(url.pathname)) return null;
    if (typeof init?.body !== 'string') return null;
    let body;
    try { body = JSON.parse(init.body); } catch { return null; }
    const ids = body.collectionIds || [body.collectionId];
    if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string' && id.startsWith('world_'))) return null;
    return { path: url.pathname, search: /\/query(?:-multi)?$/.test(url.pathname) };
}

export async function observeVectorRequests(target, run, perform, notify = () => {}) {
    const update = () => { try { notify(); } catch { /* Diagnostics must not break generation. */ } };
    const original = target.fetch;
    if (typeof original !== 'function') {
        run.status = 'unobserved';
        try { return await perform(); }
        finally { run.finishedAt = Date.now(); update(); }
    }
    let observing = true;
    const observed = async function (input, init) {
        if (!observing) return original.call(this, input, init);
        let info = null;
        try { info = requestInfo(input, init); } catch { /* Unrelated request. */ }
        if (!info) return original.call(this, input, init);
        run.requests++; if (!run.error) run.status = 'running'; update();
        let response;
        try { response = await original.call(this, input, init); }
        catch (error) {
            run.status = 'error'; run.error = 'A vector request could not reach SillyTavern.'; update();
            throw error;
        }
        if (!response.ok) {
            run.status = 'error'; run.error = `Vector request failed (HTTP ${response.status}). Check the SillyTavern console for the provider error.`;
        } else if (info.search) {
            run.searches++;
            try {
                const data = await response.clone().json();
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid vector response');
                const results = info.path.endsWith('query-multi') ? Object.values(data) : [data];
                if (!results.every(result => result && Array.isArray(result.hashes))) throw new Error('Missing vector results');
                for (const result of results) for (const hash of result?.hashes || []) run.hashes.add(hash);
                run.returned = run.hashes.size;
                if (!run.error) run.status = run.returned ? 'matches' : 'no_matches';
            } catch {
                // A successful HTTP request is not evidence of readable search results.
                if (!run.error) run.status = 'unobserved';
            }
        }
        update();
        return response;
    };
    target.fetch = observed;
    try {
        return await perform();
    } catch (error) {
        run.status = 'error'; run.error ||= 'Native vector search failed. Check the SillyTavern console.';
        throw error;
    } finally {
        observing = false;
        // Do not overwrite another extension's fetch hook if it installed one.
        if (target.fetch === observed) target.fetch = original;
        if (run.status === 'running' || run.status === 'waiting') run.status = 'not_searched';
        run.finishedAt = Date.now(); update();
    }
}

export function vectorStatus(run, { enabled = false, available = false, selected = null } = {}) {
    if (!available) return 'Native Vector Storage is not available. Enable its extension and reload SillyTavern.';
    if (!enabled) return 'World Info vectors are off in SillyTavern’s native Vector Storage.';
    if (!run) return 'Waiting for a normal chat reply. No vector search has been observed yet.';
    const source = run.provider + (run.model ? ` (${run.model})` : '');
    if (run.status === 'disabled') return 'Enable for World Info is off in native Vector Storage.';
    if (run.status === 'error') return `${source}: ${run.error}`;
    if (run.status === 'running') return `${source}: indexing or searching archive entries…`;
    if (run.status === 'no_matches') return `${source}: search completed with no matches above the configured threshold.`;
    if (run.status === 'matches') return `${source}: search completed; ${run.returned} result(s), ${run.storyMatches.size} story entry activation(s) requested by native vectors; ${selected == null ? 'World Info and archive budget decisions pending' : `${selected} retained after World Info and the archive budget`}.`;
    if (run.status === 'not_searched') return `${source}: no search request was made. Check that this story's lorebooks are attached and have eligible entries.`;
    if (run.status === 'unobserved') return `${source}: vector request results could not be observed; retrieval is not confirmed by this report.`;
    return `${source}: waiting for the native vector search.`;
}

export function entryReasons(item) {
    const labels = { 'native vector': 'Vector match (native ST)', 'keyword': 'Keyword activation (native ST)', 'world info': 'World Info activation',
        'recall': 'AI Recall', 'always on': 'Always on', 'sticky': 'Sticky (native ST)', 'activation decorator': '@@activate decorator',
        'external activation': 'External activation (source not identified)', 'pinned priority': 'Pinned priority', 'detail requested': 'Detail requested' };
    return (item.reasons?.length ? item.reasons : [item.reason]).map(reason => labels[reason] || reason || 'World Info activation').join(' + ');
}

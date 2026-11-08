// Host adapters stay outside this module so routing can be tested without ST.
export function profileMessages(request) {
    const prompt = request.assembled ?? request.prompt;
    return Array.isArray(prompt) ? prompt : [
        ...(!request.assembled && request.system ? [{ role: 'system', content: request.system }] : []),
        { role: 'user', content: prompt },
    ];
}

export function createModelRouter({ current, sendProfile, describe = profile => ({ name: profile || 'Current SillyTavern model' }),
    assert = () => {}, onRoute = () => {}, clock = () => new Date().toISOString() }) {
    let latest = null;
    const snapshot = route => route ? { ...route } : null;
    const report = route => {
        // Diagnostic failures must not resend a request or discard a valid reply.
        try { onRoute(snapshot(route)); } catch { /* Routing remains authoritative. */ }
    };
    return {
        lastRoute: () => snapshot(latest),
        async request(request, profile = '') {
            const route = { profile: String(profile || ''), name: profile || 'Current SillyTavern model', at: clock(), state: 'requesting' };
            latest = route;
            try {
                assert();
                route.name = describe(route.profile)?.name || route.name;
                report(route);
                const result = route.profile
                    ? await sendProfile(route.profile, profileMessages(request), request.maxTokens)
                    : await current(request);
                assert();
                const text = typeof result === 'string' ? result : result?.content;
                if (typeof text !== 'string' || !text.trim()) throw new Error('The connection returned no text.');
                route.state = 'received';
                return text;
            } catch (cause) {
                route.state = 'failed';
                if (!route.profile) throw cause;
                throw new Error(`Connection profile "${route.name}" could not complete this request: ${cause?.message || cause}. Retry this profile, or explicitly choose Current SillyTavern model in Settings before retrying.`, { cause });
            } finally {
                route.ended = clock();
                report(route);
            }
        },
    };
}

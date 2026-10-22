// Confirmed World Info I/O. No SillyTavern imports, so failures can be tested offline.
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const validBook = data => data && typeof data === 'object' && !Array.isArray(data) && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries);

export function createWorldInfoIO({ fetch: request = (...args) => globalThis.fetch(...args), requestHeaders = () => ({}), cache,
    assert = () => {}, onSaved = async () => {} } = {}) {
    async function post(path, name, body, operation) {
        assert();
        let response;
        try {
            response = await request(path, { method: 'POST', headers: requestHeaders(), body: JSON.stringify(body), cache: 'no-store' });
        } catch (cause) {
            throw new Error(`Could not confirm the ${operation} for lorebook "${name}". Check the SillyTavern connection.`, { cause });
        }
        assert();
        if (!response.ok) throw new Error(`Lorebook ${operation} failed for "${name}" (HTTP ${response.status}).`);
        return response;
    }

    async function readFresh(name) {
        if (!name) return null;
        const response = await post('/api/worldinfo/get', name, { name }, 'read');
        let data;
        try { data = await response.json(); }
        catch (cause) { throw new Error(`SillyTavern returned unreadable data for lorebook "${name}".`, { cause }); }
        assert();
        if (!validBook(data)) throw new Error(`SillyTavern returned invalid data for lorebook "${name}".`);
        // Never expose the cache's own object to an editor or a pending proposal.
        cache?.set(name, copy(data));
        return data;
    }

    async function saveConfirmed(name, data) {
        if (typeof name !== 'string' || !name.trim() || !validBook(data)) throw new Error('A lorebook save needs a name and valid entries.');
        // Capture exactly what is sent, before another asynchronous operation can edit it.
        const expected = copy(data);
        await post('/api/worldinfo/edit', name, { name, data: expected }, 'save');
        const actual = await readFresh(name);
        if (canonical(actual) !== canonical(expected)) {
            throw new Error(`The save for lorebook "${name}" could not be verified. Its current contents differ from the submitted changes. Refresh and review before retrying.`);
        }
        assert();
        // Keep ST's views in sync without making a second, unchecked save request.
        await onSaved(name, copy(actual));
        assert();
        return actual;
    }
    return { readFresh, saveConfirmed };
}

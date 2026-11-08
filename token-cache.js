import { hash, tokens } from './memory-engine.js';

/** Limit host tokenizer work, coalesce identical requests, and bound retained text. */
export class TokenCounter {
    constructor(count, { concurrency = 6, maxEntries = 1000, maxCharacters = 2000000 } = {}) {
        this.count = count; this.concurrency = Math.max(1, concurrency); this.maxEntries = maxEntries; this.maxCharacters = maxCharacters;
        this.cache = new Map(); this.pending = new Map(); this.queue = []; this.running = 0; this.characters = 0;
    }
    drain() {
        while (this.running < this.concurrency && this.queue.length) {
            const perform = this.queue.shift(); this.running++;
            Promise.resolve().then(perform).finally(() => { this.running--; this.drain(); });
        }
    }
    async value(content, tokenizer = '') {
        const text = String(content || ''), key = `${tokenizer}:${hash(text)}`;
        const cached = this.cache.get(key);
        if (cached?.text === text) {
            this.cache.delete(key); this.cache.set(key, cached); return cached.count;
        }
        const pending = this.pending.get(key);
        if (pending?.text === text) return pending.promise;
        let finish;
        const promise = new Promise(resolve => { finish = resolve; });
        this.pending.set(key, { text, promise });
        this.queue.push(async () => {
            let count = tokens(text);
            try { const actual = Number(await this.count?.(text + '\n')); if (Number.isFinite(actual) && actual > 0) count = actual; }
            catch { /* A local estimate keeps an unavailable tokenizer usable. */ }
            count += 4;
            if (text.length <= this.maxCharacters && this.maxEntries > 0) {
                if (this.cache.has(key)) { this.characters -= this.cache.get(key).text.length; this.cache.delete(key); }
                while (this.cache.size >= this.maxEntries || this.characters + text.length > this.maxCharacters) {
                    const oldest = this.cache.keys().next().value;
                    this.characters -= this.cache.get(oldest).text.length; this.cache.delete(oldest);
                }
                this.cache.set(key, { text, count }); this.characters += text.length;
            }
            if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
            finish(count);
        });
        this.drain(); return promise;
    }
    async entries(entries, tokenizer = '') {
        const pairs = await Promise.all(entries.map(async entry => [entry.sceneArchivist.id, await this.value(entry.content, tokenizer)]));
        return Object.fromEntries(pairs);
    }
}

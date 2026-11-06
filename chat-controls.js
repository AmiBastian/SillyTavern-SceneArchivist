import { anchorMessage, isSkipped, rangeControl, resolveEndpoints, setEndpoint, toggleSkipped } from './chat-workflows.js';
import { archivedRanges } from './core.js';
import { messageHash } from './memory-engine.js';

const actionButton = (label, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
};

export class ChatControls {
    constructor(workbench) {
        this.w = workbench;
        this.root = workbench.root;
        for (const [field, endpoint] of [['rangeFrom', 'from'], ['rangeTo', 'to']]) {
            this.root.querySelector(`[data-sa-field="${field}"]`)?.addEventListener('change', event => {
                const input = event.target, index = Number(input.value);
                if (input.value === '') void this.clear(endpoint).catch(error => this.w.h.notify(error.message, 'error'));
                else if (Number.isInteger(index) && this.chat()[index]) void this.pick(endpoint, index, false).catch(error => this.w.h.notify(error.message, 'error'));
            });
        }
        document.addEventListener('pointerdown', event => {
            if (!this.menu?.contains(event.target) && !this.trigger?.contains(event.target)) this.close();
        });
        document.addEventListener('keydown', event => {
            if (this.menu && event.key === 'Escape') { event.preventDefault(); this.close(true); }
        });
        window.addEventListener('resize', () => this.close());
        document.querySelector('#chat')?.addEventListener('scroll', () => this.close(), { passive: true });
    }

    chat() { return this.w.h.context().chat || []; }
    state() { return this.w.h.meta().rangeControl; }
    endpoints() { return resolveEndpoints(this.state(), this.chat()); }

    async save() {
        this.syncRange();
        this.mount();
        await this.w.persist();
    }

    async clear(endpoint) {
        const state = this.state();
        if (state) {
            if (endpoint) delete state.endpoints[endpoint];
            else state.endpoints = {};
        }
        for (const [key, field] of [['from', 'rangeFrom'], ['to', 'rangeTo']]) {
            if (!endpoint || endpoint === key) this.root.querySelector(`[data-sa-field="${field}"]`).value = '';
        }
        await this.save();
    }

    async pick(endpoint, index, announce = true) {
        if (!this.chat()[index]) throw new Error('That message is no longer in this chat.');
        setEndpoint(rangeControl(this.w.h.meta()), this.chat(), endpoint, index);
        await this.save();
        if (announce) this.w.h.notify(`${endpoint === 'from' ? 'Start' : 'End'} set to #${index}. Open Archive → Pick your messages to use the range.`);
    }

    syncRange() {
        const bounds = this.endpoints();
        for (const [end, field] of [['from', 'rangeFrom'], ['to', 'rangeTo']]) {
            const input = this.root.querySelector(`[data-sa-field="${field}"]`);
            if (input && (bounds[end].index !== null || bounds[end].missing)) input.value = bounds[end].index ?? '';
        }
        const note = this.root.querySelector('#sa-range-anchor-note');
        if (note) {
            const missing = Object.values(bounds).some(bound => bound.missing);
            const text = missing ? '⚠️ A selected message was removed. Pick that endpoint again.' :
                Object.values(bounds).some(bound => bound.index !== null) ? '📌 Your picks follow the messages when their numbers change.' : '';
            note.textContent = text;
            note.hidden = !text;
        }
    }

    close(focus = false) {
        this.menu?.remove();
        this.menu = null;
        this.trigger?.setAttribute('aria-expanded', 'false');
        if (focus) this.trigger?.focus();
        this.trigger = null;
    }

    open(trigger, messageNode, selected) {
        if (this.trigger === trigger) { this.close(true); return; }
        this.close();
        const index = Number(messageNode.getAttribute('mesid')), message = this.chat()[index];
        if (!message) return;
        const menu = document.createElement('div');
        menu.className = 'sa-message-menu';
        menu.id = 'sa-message-menu';
        menu.setAttribute('role', 'group');
        menu.setAttribute('aria-label', `Scene Archivist actions for message ${index}`);
        const actions = [
            ['Start range here', () => this.pick('from', index)],
            ['End range here', () => this.pick('to', index)],
            ['Remember this', () => this.w.extras.remember(index, selected)],
            [isSkipped(this.state(), message) ? 'Include in archive again' : 'Skip when archiving', async () => {
                toggleSkipped(rangeControl(this.w.h.meta()), message);
                await this.save();
                this.w.renderFlow();
            }],
        ];
        if (!message.is_user) actions.push(['What went into this reply?', () => this.w.extras.prompt.show(index)]);
        const heading = document.createElement('small');
        heading.textContent = `Scene Archivist · #${index}`;
        menu.append(heading);
        for (const [label, run] of actions) menu.append(actionButton(label, () => {
            this.close(true);
            Promise.resolve().then(run).catch(error => this.w.h.notify(error.message, 'error'));
        }));
        document.body.append(menu);
        const rect = trigger.getBoundingClientRect(), width = menu.offsetWidth, height = menu.offsetHeight;
        menu.style.left = Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)) + 'px';
        menu.style.top = Math.max(8, rect.bottom + height + 12 <= innerHeight ? rect.bottom + 5 : rect.top - height - 5) + 'px';
        this.menu = menu;
        this.trigger = trigger;
        trigger.setAttribute('aria-expanded', 'true');
        menu.querySelector('button').focus();
    }

    mount(messageIndex) {
        const chat = this.chat(), bounds = this.endpoints(), metadata = this.w.h.meta();
        const receipts = metadata.workbench?.chatMemoryReceipts || [];
        const coverage = archivedRanges(metadata);
        const legacy = coverage.filter(range => !range.source?.ranges?.length);
        const archiveHits = new Map(), memoryHits = new Set();
        for (const range of coverage) {
            for (const source of range.source?.ranges || []) {
                for (const message of source.messages || []) archiveHits.set(`${message.index}:${message.hash}`, range);
            }
        }
        for (const receipt of receipts) {
            for (const source of receipt.source?.ranges || []) {
                for (const message of source.messages || []) memoryHits.add(`${message.index}:${message.hash}`);
            }
        }
        const currentIndex = Number.isInteger(Number(messageIndex)) && messageIndex != null ? Number(messageIndex) : null;
        const messages = document.querySelectorAll(currentIndex == null ? '#chat .mes[mesid]' : `#chat .mes[mesid="${currentIndex}"]`);
        for (const node of messages) {
            const index = Number(node.getAttribute('mesid')), message = chat[index];
            const toolbar = node.querySelector('.mes_buttons');
            if (!toolbar || !message) continue;
            if (!toolbar.querySelector('.sa-message-action')) {
                const trigger = document.createElement('button');
                trigger.type = 'button';
                trigger.className = 'mes_button sa-message-action fa-solid fa-book-open';
                trigger.title = 'Scene Archivist · range and memory';
                trigger.setAttribute('aria-label', 'Scene Archivist message actions');
                trigger.setAttribute('aria-controls', 'sa-message-menu');
                trigger.setAttribute('aria-expanded', 'false');
                let selected = '';
                trigger.addEventListener('pointerdown', () => {
                    const selection = window.getSelection();
                    selected = node.querySelector('.mes_text')?.contains(selection?.anchorNode) ? selection.toString().trim() : '';
                });
                trigger.addEventListener('click', event => { event.stopPropagation(); this.open(trigger, node, selected); selected = ''; });
                const more = toolbar.querySelector(':scope > .extraMesButtons');
                if (more) more.after(trigger);
                else toolbar.append(trigger);
            }
            const badges = [];
            if (bounds.from.index === index) badges.push(['Range start', 'endpoint']);
            if (bounds.to.index === index) badges.push(['Range end', 'endpoint']);
            if (isSkipped(this.state(), message)) badges.push(['Archive skip', 'endpoint']);
            if (this.w.options().messageBadges !== 'off' && !message.is_system) {
                const key = `${index}:${messageHash(message)}`;
                const covered = archiveHits.get(key) || legacy.find(range => index >= range.from && index <= range.to);
                const remembered = memoryHits.has(key);
                if (covered) badges.push([covered.days?.length ? `Archived · ${covered.days.join(', ')}` : 'Archived', 'status']);
                else if (!isSkipped(this.state(), message)) badges.push(['To archive', 'status']);
                if (remembered) badges.push(['Memories made', 'status']);
            }
            const header = toolbar.closest('.ch_name');
            const metadataLine = header?.querySelector('.timestamp, .name_text')?.parentElement;
            let strip = node.querySelector('.sa-message-badges');
            if (!badges.length || !metadataLine) { strip?.remove(); continue; }
            if (!strip) {
                strip = document.createElement('span');
                strip.className = 'sa-message-badges';
            }
            if (strip.parentElement !== metadataLine) {
                if (metadataLine === header) toolbar.before(strip);
                else metadataLine.append(strip);
            }
            strip.dataset.mobile = this.w.options().messageBadges === 'all' ? 'show' : 'hide';
            strip.replaceChildren(...badges.map(([text, kind]) => {
                const badge = document.createElement('span');
                badge.textContent = text;
                badge.title = text;
                badge.dataset.kind = kind;
                return badge;
            }));
        }
    }

    anchor(index) { return anchorMessage(this.chat()[index]); }
}

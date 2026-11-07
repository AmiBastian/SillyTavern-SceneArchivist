import * as M from './memory-engine.js';
import { same } from './entry-journal.js';
import { addLittleThings, littleThings, makeLittleThing, noteMatchesUnit, setLittleThings, sourcesOverlap, verifiedNoteSource } from './little-things.js';
import { recordSources } from './recovery-tools.js';
import { escape as html } from './workflow-tools.js';

const action = (name, label, id = '') => `<button type="button" class="menu_button" data-sa-library-action="${name}" data-id="${html(id)}">${label}</button>`;
const recordAction = (name, label, id) => `<button type="button" class="menu_button" data-sa-action="${name}" data-id="${html(id)}">${label}</button>`;
const sourceLabel = source => source?.ranges?.length ? source.ranges.map(({ from, to }) => from === to ? `#${from}` : `#${from} to #${to}`).join(', ') : '';
const dateLabel = entry => (M.record(entry).dates || []).filter(date => M.calendarDay(date)).slice(0, 2).join(' · ');

export class StoryLibrary {
    constructor(workbench) {
        this.w = workbench;
        this.pane = workbench.panes.library;
        this.pane.insertAdjacentHTML('afterbegin', `<div class="sa-library-nav" role="group" aria-label="Library views">
            ${[['timeline', '🗓️ Timeline'], ['little', '🧵 Little Things'], ['all', '📚 All records']].map(([id, label]) =>
                `<button type="button" class="menu_button" data-sa-library-mode="${id}">${label}</button>`).join('')}
            </div><section class="sa-timeline-reader" data-sa-library-view="timeline"></section>
            <section class="sa-little-list" data-sa-library-view="little" hidden></section>`);
        this.pane.addEventListener('click', event => {
            const tab = event.target.closest('button[data-sa-library-mode]');
            if (tab) return this.show(tab.dataset.saLibraryMode);
            const button = event.target.closest('[data-sa-library-action]');
            if (button) void this.dispatch(button).catch(error => this.w.h.notify(error.message, 'error'));
        });
        this.show('timeline');
    }

    reset() {
        this.unitId = '';
        this.limit = 40;
        this.show('timeline');
    }

    show(mode) {
        this.pane.dataset.saLibraryMode = mode;
        for (const tab of this.pane.querySelectorAll('button[data-sa-library-mode]')) tab.setAttribute('aria-pressed', String(tab.dataset.saLibraryMode === mode));
        for (const view of this.pane.querySelectorAll('[data-sa-library-view]')) view.hidden = view.dataset.saLibraryView !== mode;
        this.w.renderLibrary();
    }

    render() {
        if (this.pane.dataset.saLibraryMode === 'timeline') this.renderTimeline();
        if (this.pane.dataset.saLibraryMode === 'little') this.renderNotes();
    }

    renderTimeline() {
        const w = this.w, view = this.pane.querySelector('[data-sa-library-view="timeline"]');
        const units = w.entries.filter(entry => ['unit', 'recap'].includes(M.record(entry)?.type) && M.active(entry)).sort((a, b) => {
            const left = M.record(a), right = M.record(b);
            const date = e => (M.record(e).dates || []).map(M.calendarDay).filter(Boolean).sort().at(-1) || '';
            return date(b).localeCompare(date(a)) || (right.unit?.number ?? 0) - (left.unit?.number ?? 0) || String(right.updated).localeCompare(String(left.updated));
        });
        const unit = units.find(entry => M.record(entry).id === this.unitId) || units[0];
        if (!unit) { view.innerHTML = '<p class="sa-empty-state">Your timeline starts with the first scene you save.</p>'; return; }
        const r = M.record(unit);
        const related = w.entries.filter(entry => {
            const memory = M.record(entry);
            return memory?.type === 'memory' && M.active(entry) && (memory.derivedFrom?.some(id => id === r.id || r.covers?.includes(id)) ||
                recordSources(memory).some(source => sourcesOverlap(source, r.source)));
        });
        const covered = [unit, ...(r.covers || []).map(id => w.find(id)).filter(Boolean)];
        const notes = w.littleThings().filter(note => covered.some(entry => noteMatchesUnit(note, entry)));
        const source = recordSources(r).find(item => item.ranges?.length);
        const ids = new Set(units.slice(0, this.limit || 40).map(entry => M.record(entry).id));
        ids.add(r.id);
        view.innerHTML = `<div class="sa-timeline-index" aria-label="Saved scenes">${units.filter(entry => ids.has(M.record(entry).id)).map(entry => {
            const record = M.record(entry), id = record.id, label = sourceLabel(record.source);
            return `<button type="button" class="sa-timeline-link" data-sa-library-action="unit" data-id="${html(id)}" aria-pressed="${id === r.id}">
                <b>${html(M.title(entry))}</b><small>${html(label ? `Messages ${label}` : dateLabel(entry) || entry.world)}</small></button>`;
        }).join('')}${units.length > ids.size ? action('more', 'Show older scenes') : ''}</div>
        <article class="sa-timeline-detail"><header><p class="sa-eyebrow">${r.type === 'recap' ? 'RECAP' : 'ARCHIVED SCENE'}</p><h3>${html(M.title(unit))}</h3></header>
            <p class="sa-hint">${html([dateLabel(unit), sourceLabel(source) && `Messages ${sourceLabel(source)}`].filter(Boolean).join(' · '))}</p>
            <div class="sa-row">${recordAction('sources', '🔎 View sources', r.id)}${this.jumpButton(source, 'unitSource', r.id)}
                ${recordAction('inspect', '✏️ Edit summary', r.id)}</div>
            <h4>🗂️ Summary</h4><pre class="sa-scene-text">${html(String(unit.content).trim().split('\n').slice(1).join('\n').trim() || unit.content)}</pre>
            <h4>🧠 Linked character memories</h4>
            ${related.length ? `<div class="sa-row">${related.map(entry => recordAction('inspect', html(M.record(entry).subject || M.title(entry)), M.record(entry).id)).join('')}</div>` : '<p class="sa-hint">No character memories link to this scene yet.</p>'}
            <h4>🧵 Little Things</h4>${notes.length ? notes.slice(0, 12).map(note => this.noteRow(note)).join('') : '<p class="sa-hint">No little details saved for this scene.</p>'}
        </article>`;
    }

    renderNotes() {
        const view = this.pane.querySelector('[data-sa-library-view="little"]'), notes = this.w.littleThings().slice().reverse();
        view.innerHTML = `<header class="sa-little-head"><div><h3>🧵 Little Things</h3>
            <p class="sa-hint">The gifts, habits and loose threads worth remembering. A cue brings a few back when they fit the scene.</p></div>
            ${action('editNote', '➕ Add a detail')}</header>
            ${notes.length ? `<label class="sa-field"><span>Find a detail</span><input type="search" class="text_pole" data-sa-note-search placeholder="Try a cue, name, or bit of dialogue"></label>
                <div class="sa-little-results">${notes.map(note => this.noteRow(note)).join('')}</div>` :
                '<p class="sa-empty-state">Save one here, use Remember this on a message, or review suggestions after archiving.</p>'}`;
        view.querySelector('[data-sa-note-search]')?.addEventListener('input', event => {
            const query = event.target.value.trim().toLowerCase();
            for (const row of view.querySelectorAll('.sa-little-row')) row.hidden = !row.textContent.toLowerCase().includes(query);
        });
    }

    jumpButton(source, name, id) {
        const w = this.w;
        return verifiedNoteSource(source, w.sourceId(), w.h.context().chat || [])
            ? action(name, `📍 Jump to #${source.ranges[0].from}`, id) : '';
    }

    noteRow(note) {
        const status = note.thread ? note.thread === 'open' ? 'Open thread' : 'Resolved thread' : '';
        const meta = [status, note.date, note.knows?.length ? 'Known by ' + note.knows.join(', ') : 'Shared detail', sourceLabel(note.source) && 'Source ' + sourceLabel(note.source)].filter(Boolean);
        return `<article class="sa-little-row"><p>${html(note.text)}</p><p class="sa-hint">${html(meta.join(' · '))}</p>
            ${note.cues?.length ? `<p class="sa-hint">Cues · ${html(note.cues.join(', '))}</p>` : ''}
            <div class="sa-row">${this.jumpButton(note.source, 'noteSource', note.id)}${note.recordId && this.w.find(note.recordId) ? recordAction('sources', '🔎 Source record', note.recordId) : ''}
                ${action('editNote', '✏️ Edit detail', note.id)}${action('loadNote', '📌 Load next reply', note.id)}</div></article>`;
    }

    async dispatch(button) {
        const id = button.dataset.id, w = this.w;
        switch (button.dataset.saLibraryAction) {
            case 'unit':
                this.unitId = id;
                this.renderTimeline();
                this.pane.querySelector('[data-sa-library-action="unit"][aria-pressed="true"]')?.focus();
                break;
            case 'more':
                this.limit = (this.limit || 40) + 40;
                this.renderTimeline();
                break;
            case 'editNote': return this.edit(id);
            case 'loadNote': return this.loadNext(id);
            case 'noteSource': return this.jump(w.littleThings().find(note => note.id === id)?.source, this.pane);
            case 'unitSource': return this.jump(recordSources(M.record(w.find(id))).find(item => item.ranges?.length), this.pane);
        }
    }

    jump(source, root) {
        const w = this.w;
        if (!verifiedNoteSource(source, w.sourceId(), w.h.context().chat || [])) throw new Error('Open the original chat with its matching source messages.');
        return w.h.jumpToMessage(source.ranges[0].from, root);
    }

    loadNext(id) {
        const w = this.w;
        if (!w.h.scanSupported || !w.h.isActive()) throw new Error('Attach the archive to a chat on a SillyTavern version with World Info scan support.');
        w.sceneRecall.request(id);
        w.h.notify('Queued for the next eligible reply, within the memory budget.', 'success');
    }

    async edit(id) {
        const w = this.w, origin = w.identity(), archive = w.h.settings().lorebook;
        if (archive) await w.loadBooks();
        const previous = id ? w.littleThings().find(note => note.id === id) : null;
        if (id && !previous) throw new Error('This detail is no longer in the archive.');
        const root = document.createElement('div');
        root.className = 'sa-review sa-note-editor';
        root.innerHTML = `<h3>🧵 ${previous ? 'Edit a little thing' : 'Keep a little thing'}</h3>
            <p class="sa-hint">Keep the detail short and give it a cue that could come up in chat. Leave “Who knows” empty only for shared story details.</p>
            <label class="sa-field"><span>Detail</span><textarea class="text_pole" rows="4" maxlength="600" name="text" required></textarea></label>
            <div class="sa-grid">
                <label class="sa-field"><span>Cues (comma separated)</span><input class="text_pole" name="cues" placeholder="blue key, forgot the key"></label>
                <label class="sa-field"><span>Who knows (comma separated)</span><input class="text_pole" name="knows" placeholder="Rowan"></label>
                <label class="sa-field"><span>People involved</span><input class="text_pole" name="participants" placeholder="Rowan, Mara"></label>
                <label class="sa-field"><span>Story date, if known</span><input class="text_pole" name="date" type="date"></label>
                <label class="sa-field"><span>Thread</span><select class="text_pole" name="thread"><option value="">Detail</option><option value="open">Open promise or thread</option><option value="closed">Resolved promise or thread</option></select></label>
                ${previous ? '' : '<label class="sa-field"><span>Source message # (optional)</span><input class="text_pole" name="message" type="number" min="0"></label>'}
            </div>
            ${previous ? `<p class="sa-hint">${html(previous.source?.actualChatId || '')} ${html(sourceLabel(previous.source))}</p>
                <label class="checkbox_label"><input type="checkbox" name="remove"><span>🗑️ Remove this detail when I save</span></label>` : ''}`;
        for (const input of root.querySelectorAll('[name]')) {
            if (!Object.hasOwn(previous || {}, input.name)) continue;
            const value = previous[input.name];
            input.value = Array.isArray(value) ? value.join(', ') : value;
        }
        if (!(await w.h.confirm(root, { okButton: '💾 Save detail' }))) return;
        if (origin !== w.identity() || archive !== w.h.settings().lorebook) throw new Error('The chat or archive changed while the detail was open.');
        const fields = Object.fromEntries([...root.querySelectorAll('[name]')].map(el => [el.name, el.type === 'checkbox' ? el.checked : el.value]));
        const index = fields.message ? Number(fields.message) : null;
        return this.save(fields, { previous, source: () => {
            if (index === null) return previous?.source;
            if (!Number.isInteger(index) || !w.h.context().chat?.[index] || w.h.context().chat[index].is_system) throw new Error('Choose a story message from this chat.');
            return w.source([{ from: index, to: index }]);
        } });
    }

    async save(fields, { previous = null, source } = {}) {
        const w = this.w, origin = w.identity();
        if (!fields.remove && !String(fields.text || '').trim()) throw new Error('Give the detail a line of text.');
        if (!(await w.h.ensureArchive())) return;
        return w.withLock(async () => {
            await w.loadBooks();
            if (origin !== w.identity()) throw new Error('The chat changed while the detail was open.');
            const name = w.h.settings().lorebook, base = w.books[name], book = M.copy(base);
            const notes = littleThings(book), current = notes.find(note => note.id === previous?.id);
            if (previous && !same(previous, current)) throw new Error('This detail changed. Open it again before saving.');
            const next = fields.remove ? null : makeLittleThing(fields, source?.(), previous);
            const remaining = notes.filter(note => note.id !== previous?.id);
            setLittleThings(book, remaining, w.state().storyId);
            if (next && !addLittleThings(book, [next], w.state().storyId).length) throw new Error('That detail is already saved in Little Things.');
            await w.write({ [name]: book }, { [name]: M.bookHash(base) }, fields.remove ? 'Remove a little thing' : 'Save a little thing');
            w.h.notify(fields.remove ? 'Removed from Little Things.' : 'Saved in Little Things.', 'success');
        });
    }
}

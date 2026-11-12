import * as M from './memory-engine.js';
import { diffHtml, escape as html, proposalKey } from './workflow-tools.js';

export async function reviewChanges(workbench, changes, title = 'Review changes', note = '', options = {}) {
    if (workbench.bulkRun) return true;
    const root = document.createElement('div'); root.className = 'sa-review';
    root.innerHTML = `<h3>${html(title)}</h3><p class="sa-note">${html(note || 'Review the result before it is saved. The old content remains in revision history.')}</p>`;
    const hasLittleThings = changes.some(change => change.note);
    if (hasLittleThings) root.insertAdjacentHTML('beforeend', '<p class="sa-hint">Uncheck any Little Thing you want to skip when you save. Review later keeps the whole draft.</p>');
    const groups = M.unique(changes.map(change => change.section));
    if (groups.length > 1) {
        root.classList.add('sa-combined-review');
        const filters = document.createElement('div');
        filters.className = 'sa-review-filters'; filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Review sections');
        for (const label of ['All results', ...groups]) {
            const filter = document.createElement('button');
            filter.type = 'button'; filter.className = 'menu_button';
            filter.textContent = label + ' · ' + (label === 'All results' ? changes.length : changes.filter(change => change.section === label).length);
            filter.setAttribute('aria-pressed', String(label === 'All results'));
            filter.addEventListener('click', () => {
                for (const element of filters.children) element.setAttribute('aria-pressed', String(element === filter));
                for (const element of root.querySelectorAll('[data-review-section]')) element.hidden = label !== 'All results' && element.dataset.reviewSection !== label;
                const first = root.querySelector('details[data-review-section]:not([hidden])');
                if (first && label !== 'All results') first.open = true;
            });
            filters.append(filter);
        }
        root.append(filters);
    }
    if (options.partial) {
        const toolbar = document.createElement('div'); toolbar.className = 'sa-row';
        for (const [label, checked] of [['Select all results', true], ['Clear all selections', false]]) { const b = document.createElement('button'); b.type = 'button'; b.className = 'menu_button'; b.textContent = label; b.addEventListener('click', () => root.querySelectorAll('[data-review-include]:not(:disabled)').forEach(c => { c.checked = checked; })); toolbar.append(b); }
        root.append(toolbar);
    }
    const job = workbench.state().job?.status === 'running' ? workbench.state().job : null, edits = job ? (job.reviewEdits ??= {}) : {};
    let section;
    for (const c of changes) {
        if (c.section && c.section !== section) {
            section = c.section;
            const heading = document.createElement('h4'); heading.textContent = section; heading.dataset.reviewSection = section; root.append(heading);
        }
        const key = proposalKey(c), saved = edits[key];
        if (saved) {
            if (c.content !== saved.content) delete c.afterTokens;
            c.content = saved.content;
            if (!c.conflict) c.include = saved.include;
        }
        const directConflict = c.conflict && Object.hasOwn(c.conflict, 'original');
        const beforeTokens = c.beforeTokens ?? M.tokens(c.before || '');
        const d = document.createElement('details'); d.className = 'sa-proposal'; d.open = changes.length <= 4; d.dataset.reviewSection = c.section || '';
        d.innerHTML = `<summary>${options.partial || c.optional ? '<input type="checkbox" data-review-include aria-label="Approve this result">' : ''}<b>${html(c.title || 'Proposed result')}</b><span class="sa-badge" data-review-tokens>${beforeTokens} → ${c.afterTokens ?? M.tokens(c.content || '')} estimated tokens</span></summary>
            ${c.evidence ? `<p class="sa-hint">📍 ${html(c.evidence)}</p>` : ''}
            <div class="sa-review-compare${c.before || directConflict ? ' sa-has-original' : ''}${directConflict ? ' sa-has-conflict' : ''}">${directConflict ? '<div><b>Original when the job started</b><pre data-review-original></pre></div>' : ''}
                ${c.before || directConflict ? `<div><b>${html(c.beforeLabel || 'Before')}</b><pre data-review-before></pre></div>` : ''}
                <label><b>${html(c.afterLabel || 'Proposed')}</b><textarea class="text_pole" rows="${c.note ? 4 : 9}" ${c.note ? 'maxlength="600"' : ''} ${c.conflict ? 'readonly' : ''}></textarea></label></div>
            ${c.before ? '<details><summary>Highlighted changes</summary><div class="sa-diff" aria-label="Added and removed lines"></div></details>' : ''}`;
        if (c.conflict) {
            const conflict = document.createElement('p'); conflict.className = 'sa-warnline'; conflict.textContent = c.conflict.message;
            d.querySelector('summary').after(conflict); d.open = true;
            d.insertAdjacentHTML('beforeend', '<label class="checkbox_label"><input type="checkbox" data-review-discard><span>Discard this proposal</span></label>');
        }
        if (c.warning) {
            const warning = document.createElement('p'); warning.className = 'sa-warnline'; warning.textContent = c.warning;
            d.querySelector('summary').after(warning); d.open = true;
        }
        const textarea = d.querySelector('textarea'); textarea.value = c.content || '';
        if (c.before || directConflict) d.querySelector('[data-review-before]').textContent = c.before || 'No saved entry in this slot.';
        if (directConflict) d.querySelector('[data-review-original]').textContent = c.conflict.original ?? 'No entry before the job started.';
        const check = d.querySelector('[data-review-include]'); if (check) { check.disabled = !!c.conflict; check.checked = !c.conflict && c.include !== false; check.addEventListener('click', e => e.stopPropagation()); }
        const diff = d.querySelector('.sa-diff');
        if (diff) diff.innerHTML = diffHtml(c.before, c.content);
        textarea.addEventListener('input', () => {
            d.querySelector('[data-review-tokens]').textContent = `${beforeTokens} → ${M.tokens(textarea.value)} estimated tokens`;
            if (diff) diff.innerHTML = diffHtml(c.before, textarea.value);
        });
        if (c.settingsAfter && JSON.stringify(c.settingsBefore) !== JSON.stringify(c.settingsAfter)) {
            const settings = document.createElement('details'); settings.innerHTML = '<summary>Entry settings and processing receipts</summary><pre></pre>';
            settings.querySelector('pre').textContent = JSON.stringify({ before: c.settingsBefore, after: c.settingsAfter }, null, 2); d.append(settings);
        }
        root.append(d); c.node = d;
    }
    const accepted = await workbench.h.confirm(root, { okButton: options.partial ? '💾 Save selected' : '💾 Save reviewed result', cancelButton: job?.status === 'running' ? 'Review later' : 'Cancel' });
    for (const c of changes) {
        const editedText = c.node.querySelector('textarea').value;
        const originalText = String(c.content || '');
        // Accepting an untouched review must preserve source hashes, including
        // existing trailing whitespace and normalized textarea line endings.
        c.content = editedText.trim() === originalText.replace(/\r\n?/g, '\n').trim() ? originalText : editedText.trim();
        c.include = !c.conflict && (c.node.querySelector('[data-review-include]')?.checked ?? true);
        c.discard = accepted && !!c.node.querySelector('[data-review-discard]')?.checked;
        if (job && !c.conflict) edits[proposalKey(c)] = { content: c.content, include: c.include };
        delete c.node;
    }
    if (job) await workbench.persist();
    if (!accepted) return false;
    if (changes.some(c => c.include && !c.content)) throw new Error('An approved entry cannot be empty.');
    if (options.partial && !hasLittleThings && !changes.some(c => c.include || c.discard)) throw new Error('Choose a result to save or discard, or use Review later to retain all results.');
    return true;
}

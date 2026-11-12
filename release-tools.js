import * as M from './memory-engine.js';
import { VERSION } from './version.js';
import { escape as html } from './workflow-tools.js';

export const WORKFLOW_PRESETS = {
    simple: { name: 'Simple', note: 'Archive, create memories, then review. No extra recall or audit requests.',
        settings: { recall: false, memoryAuto: true, trackerAuto: false }, workbench: { preciseDelivery: true, auditCondense: false, memoryTools: false, reviewMode: 'end', autoCondense: 'off' }, flow: { auditMemories: false, rolling: false, singleRequest: false } },
    detailed: { name: 'Detailed', note: 'Add evidence-audit advice and optional AI Recall. An audit adds one request per memory or condensation pass; recall adds up to one request before a reply.',
        settings: { recall: true, memoryAuto: true }, workbench: { preciseDelivery: true, auditCondense: true, reviewMode: 'end', autoCondense: 'suggest', groupMemoryScope: true }, flow: { auditMemories: true, rolling: false, singleRequest: false } },
    automatic: { name: 'Mostly Automatic', note: 'Prepare rolling memories after 30 eligible messages, keep the newest four out, and retain review before saving. Recap maintenance remains a suggestion.',
        settings: { memoryAuto: true }, workbench: { preciseDelivery: true, reviewMode: 'end', autoCondense: 'suggest', groupMemoryScope: true }, flow: { rolling: true, rollingEvery: 30, rollingBuffer: 4, auditMemories: false } },
};

/** Whitelist structural diagnostics. Story text, names, URLs and raw errors never enter it. */
export function diagnosticSnapshot(w) {
    const job = w.state().job, last = w.state().telemetry?.last, s = w.h.settings();
    const category = text => /context|tokens|budget/i.test(text || '') ? 'capacity' : /profile|provider|connection|gateway|timeout/i.test(text || '') ? 'connection'
        : /save|write|receipt|changed/i.test(text || '') ? 'storage or changed evidence' : /JSON|parse|incomplete|cit/i.test(text || '') ? 'response validation' : text ? 'other' : null;
    return { version: VERSION, capabilities: { nativeScan: w.h.scanSupported !== false, functionTools: !!w.h.context().isToolCallingSupported?.(),
        nativeVectors: !!w.h.vectorSettings?.()?.enabled_world_info },
        records: Object.fromEntries(M.TYPES.map(type => [type, w.entries.filter(entry => M.record(entry)?.type === type).length])),
        allowances: { memory: Number(w.options().budget) || 0, helperInput: Number(w.options().requestBudget) || 0 },
        routing: { archiveProfileSelected: !!s.archiveProfile, helperProfileSelected: !!s.sideProfile },
        job: job ? { status: ['running', 'paused', 'failed', 'ready', 'done', 'canceled'].includes(job.status) ? job.status : 'other', completed: Number(job.cursor) || 0,
            steps: Array.isArray(job.steps) ? job.steps.length : 0, failureCategory: category(job.error) } : null,
        lastRequest: last ? { input: Number(last.input) || 0, output: Number(last.output) || 0, failureCategory: category(last.error) } : null };
}

export async function chooseWorkflow(w) {
    const root = document.createElement('div'); root.className = 'sa-review';
    root.innerHTML = '<h3>Choose a workflow</h3><p>These presets change automation and review controls. Your prompts, model routes, references, persona choice and saved story stay as configured.</p><select class="text_pole" aria-label="Workflow preset"></select><p class="sa-hint"></p>';
    const select = root.querySelector('select'), description = root.querySelector('.sa-hint');
    const scope = document.createElement('p'); scope.className = 'sa-hint';
    scope.textContent = w.h.profileState?.()?.label || 'Applies to the active settings scope. Bound workflow profiles can also be used by other chats.';
    root.append(scope);
    for (const [id, preset] of Object.entries(WORKFLOW_PRESETS)) select.add(new Option(preset.name, id));
    const explain = () => { description.textContent = WORKFLOW_PRESETS[select.value].note; };
    select.addEventListener('change', explain); explain();
    const origin = w.identity();
    if (!(await w.h.confirm(root, { okButton: 'Apply workflow', large: false })) || origin !== w.identity()) return;
    const preset = WORKFLOW_PRESETS[select.value];
    Object.assign(w.h.settings(), preset.settings); Object.assign(w.options(), preset.workbench);
    Object.assign((w.liveState().flowSettings ??= {}), preset.flow);
    w.h.saveSettings(); await w.persist(); w.syncOptions(); w.renderFlow();
}

export async function showForgotten(w, selectedReply = null) {
    const identity = w.identity();
    await w.loadBooks();
    if (identity !== w.identity()) return;
    const root = document.createElement('div'); root.className = 'sa-review';
    const reply = selectedReply?.index;
    root.innerHTML = `<h3>Why was this forgotten?${Number.isInteger(reply) && reply >= 0 ? ` · Reply #${reply}` : ''}</h3><p>Compare your saved evidence with what ${selectedReply ? 'this reply’s' : 'the latest'} Memory Trail recorded.</p><input class="text_pole" type="search" placeholder="The fact or detail you expected" aria-label="Forgotten detail"><div class="sa-prose" aria-live="polite"></div>`;
    const query = root.querySelector('input'), result = root.querySelector('.sa-prose');
    const trace = selectedReply ? selectedReply.trace
        : w.extras?.prompt.lastTrace || w.h.context().chat?.findLast(message => message.extra?.sceneArchivistPrompt)?.extra.sceneArchivistPrompt;
    let timer;
    const check = () => {
        const rows = query.value.trim() ? w.memoryIndex.search(w.entries, query.value).slice(0, 8) : [];
        result.innerHTML = query.value.trim() ? (rows.length ? rows.map(row => {
            const id = M.record(row.parent).id, loaded = trace?.active?.find(item => item.id === id), skipped = trace?.omitted?.find(item => item.id === id);
            const excerpt = row.excerpt;
            const differentLines = excerpt && loaded?.excerpts?.length && !loaded.excerpts.some(part =>
                part.fromLine <= excerpt.fromLine && part.toLine >= excerpt.toLine);
            const reason = differentLines ? 'This reply received other lines from this record.'
                : loaded ? 'The trail records delivery. Check the source if the model overlooked or misunderstood the detail.'
                : skipped ? 'Skipped · ' + skipped.reason : trace ? 'No delivery is recorded among this trail’s retained items. Check activation, character scope and the prompt.'
                    : 'No reply trail is available. Generate a reply, then inspect its Memory Trail.';
            const control = (action, label) => `<button type="button" class="menu_button" data-fix-action="${action}" data-id="${html(id)}">${label}</button>`;
            return `<article class="sa-result"><b>${html(M.title(row.parent))}</b><p>${html(reason)}</p>
                <div class="sa-row">${control('sources', 'View sources')}${control('inspect', 'Inspect / edit')}${control('loadDetail', 'Load full source next reply')}</div></article>`;
        }).join('') : '<p>No saved text matches those words. Try a synonym, Ask the archive, or inspect original sources to distinguish a missing extraction from different wording.</p>') : '';
    };
    query.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 120); });
    result.addEventListener('click', event => {
        const control = event.target.closest('[data-fix-action]');
        if (!control || w.identity() !== identity) return;
        void w.dispatch(control.dataset.fixAction, control).catch(error => w.h.notify(error.message, 'error'));
    });
    try { await w.h.show(root); } finally { clearTimeout(timer); }
}

export async function showDiagnostics(w) {
    const root = document.createElement('div'); root.className = 'sa-review';
    root.innerHTML = '<h3>Review diagnostics before exporting</h3><p>This report includes versions, counts, capabilities and error categories. It excludes story text, names, profile names, URLs, credentials and full error messages. Edit or remove anything before downloading.</p><textarea class="text_pole" rows="18" aria-label="Diagnostics privacy preview"></textarea>';
    root.querySelector('textarea').value = JSON.stringify(diagnosticSnapshot(w), null, 2);
    if (await w.h.confirm(root, { okButton: 'Download reviewed report' })) w.h.download('Scene-Archivist-diagnostics.json', root.querySelector('textarea').value, 'application/json');
}

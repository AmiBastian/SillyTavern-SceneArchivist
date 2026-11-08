# Scene Archivist: master product roadmap

Baseline: Scene Archivist 2.0.1. Prepared November 8, 2026.

## Objective

Make Scene Archivist a dependable, easy-to-adopt continuity workspace for long SillyTavern stories. Success means accurate memory, appropriate character knowledge, recoverable edits, predictable cost, responsive interaction, and a first experience people can complete without help.

This is a proposed backlog of 150 concrete items. It does not assert that every listed validation target is currently broken, or that every optional experiment should ship. Existing capabilities are identified as foundations to strengthen.

The [core candidate checklist](CORE-CANDIDATE.md) records implemented behavior, completed checks and remaining validation limits. The original proposals and public 2.0.1 findings below are retained as planning history rather than relabeled as completed work.

## Reading the backlog

- **Fix:** a specific behavior identified in the code that should change.
- **Improve:** strengthen a capability that already exists.
- **Add:** a proposed new capability.
- **Verify:** establish behavior through a meaningful test or compatibility check.
- **P0:** correctness, routing, data integrity, and measurement foundations.
- **P1:** the first major quality and usability investment.
- **P2:** follow-on refinement after the foundations demonstrate improvement.
- **P3:** optional experiments, specialist features, or integrations. Promote only when user evidence justifies the cost.

There is no evidence here of a measured overall winner. Competitor research used current project documentation and selected implementation files, plus Reddit reports treated as individual experiences. A common live-model benchmark has not been run.

## Existing strengths to retain

Reviewed archive/memory/tracker workflows; extraction from chat, saved archive, or both; persona opt-in; diaries; structured knowledge states; dates and learning history; Little Things; native lorebooks; source links; revisions; protections; job recovery; branching and sharing; token budgeting; optional native vectors and AI Recall; movable theme-aware Memory Trail; complete story and workflow exports.

## Concrete findings in 2.0.1

1. **Helper routing is inconsistent.** In index.js, sideCall() catches a selected-profile failure and uses generateRaw() on the current model. Main workflow sendFlowRequest()/requestFlow() instead expose an explicit retry on the current model. A helper profile test can therefore succeed on a fallback route. SA-075 and SA-100 address this. This is a static-code finding, not a newly executed provider-outage test.
2. **Normal character memories remain larger lists.** commitMemories() builds a character document, while the allocator charges for a whole entry. Structured facts and Little Things already have finer granularity. SA-001, SA-009, and SA-016 extend that granularity without discarding the current human-readable view.
3. **AI Recall starts with lexical candidates.** beforeGeneration() builds its shortlist with M.search(). Native vector integration already exists separately. SA-002 combines candidate sources rather than describing semantic retrieval as entirely absent.
4. **Archive questions and current tools read saved records.** ask(), toolLookup(), and open_day expose saved entries. Source links and rebuild-from-source already exist, but a question-driven original-scene fallback is a separate addition, SA-006.
5. **Reference context has no dedicated fit policy.** readReferences() concatenates the selected entries. The current overflow breakdown correctly explains that size after a failed check. SA-055 and SA-056 add visibility and deliberate fitting before a request.
6. **The passing tests do not establish semantic recall quality.** The workflow fixture returns scripted model output. Existing tests remain valuable; SA-129 through SA-134 add different kinds of evidence.

Code reviewed: [index.js](https://github.com/AmiBastian/SillyTavern-SceneArchivist/blob/v2.0.1/index.js), [workbench.js](https://github.com/AmiBastian/SillyTavern-SceneArchivist/blob/v2.0.1/workbench.js), [memory-engine.js](https://github.com/AmiBastian/SillyTavern-SceneArchivist/blob/v2.0.1/memory-engine.js), [prompt-inspection.js](https://github.com/AmiBastian/SillyTavern-SceneArchivist/blob/v2.0.1/prompt-inspection.js), [world-info-io.js](https://github.com/AmiBastian/SillyTavern-SceneArchivist/blob/v2.0.1/world-info-io.js), and [tests/workflow.test.js](https://github.com/AmiBastian/SillyTavern-SceneArchivist/blob/v2.0.1/tests/workflow.test.js).

## Recommended implementation sequence

| Milestone | Core work | Exit criterion |
| --- | --- | --- |
| 1. Prove and protect the foundation | SA-075, SA-079 through SA-081, SA-100, SA-129 through SA-133, SA-136, SA-138, SA-140 | Routing is explicit; crash/retry behavior is covered; baseline extraction/retrieval results are recorded. |
| 2. Recall precisely | SA-001, SA-002, SA-006 through SA-010, SA-016, SA-017 | Relevant details omitted from a summary can be found in verified original scenes within a fixed allowance. |
| 3. Make adoption easy | SA-055, SA-056, SA-064, SA-087, SA-088, SA-099, SA-103, SA-106, SA-107, SA-141, SA-144 | A new user can save, verify, troubleshoot, and afford the first useful memory with clear defaults. |
| 4. Improve long-story maintenance | SA-018 through SA-021, SA-043, SA-065 through SA-074, SA-109 through SA-118 | Long chats show better retention and responsive operation without erasing history or increasing uncontrolled work. |
| 5. Expand after measurement | Selected P2/P3 imports, integrations, character-development tools, graphs, translations, and catalog submission | Each addition has a demonstrated user benefit, a maintenance owner, and a regression check. |

Feature dependencies: fine-grained provenance and stable identities precede selective recall and original-source fallback. Benchmark baselines precede superiority claims. A checkpoint and undo path precede new automatic write tools. Source or embedding-model changes invalidate affected indexes. Shared-writer coordination depends on what the SillyTavern host can actually support.

## Benchmark plan

Use invented, redistributable stories with known facts and original support ranges. Include small preferences, exact quotations, object transfers, rumors, secrets, mistaken beliefs, aliases, retcons, time skips, flashbacks, and forks. Include sparse relevant details among many irrelevant events and questions that use different wording.

Compare the existing 2.0.1 baseline, the proposed build, native summarization, and selected competitors. Run two tracks: a documented out-of-box setup and a controlled setup with the same response model, recent raw history, total context allowance, and extraction model where supported. Record all unavoidable configuration differences.

Measure extraction omissions and unsupported facts; retrieval precision and recall; wrong-speaker, wrong-date, and wrong-branch results; grounded final-answer quality; input/output/cached tokens when reported; extra calls; elapsed time; and browser overhead. Use repeated runs for variable model output. Keep live paid-model runs explicit and budgeted. Publish results before describing the extension as the best.

## Full backlog

### Recall and retrieval

Current foundation: keyword search, native vector activation, optional AI Recall, two read-only memory tools, source links, and a shared budget already exist.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-001 | Add | P1 | **Index individual events inside long character memory lists.** A single relevant event can load without injecting its entire character list; the existing readable view remains available. |
| SA-002 | Improve | P1 | **Combine keyword and semantic candidate searches.** Independent lexical and semantic candidates can both reach the selector; neither is discarded just for missing the other signal. |
| SA-003 | Improve | P1 | **Handle paraphrases, aliases, and indirect callbacks.** A test such as 'make her usual' can find an evidenced preference without requiring its exact wording. |
| SA-004 | Improve | P1 | **Use scene participants and location to narrow recall.** Candidate selection uses the active scene while allowing an explicitly requested absent person or earlier place. |
| SA-005 | Add | P2 | **Recognize question types such as who, when, and why.** Date, ownership, causality, and relationship questions retrieve the corresponding evidence rather than a generic recent record. |
| SA-006 | Add | P1 | **Query original scenes when saved memory is insufficient.** A bounded fallback reads verified source messages, respects date/branch/speaker rules, and cites the original range. |
| SA-007 | Improve | P1 | **Give each recalled claim an evidence link.** An answer identifies the exact supporting event or source passage instead of citing only an entire character list. |
| SA-008 | Improve | P1 | **Handle missing and uncertain evidence explicitly.** The helper can say that the available evidence does not establish an answer; unsupported details are not filled in. |
| SA-009 | Improve | P1 | **Pack useful details into the memory allowance.** Relevant short details can be selected from larger records while mandatory protections and the overall cap remain enforced. |
| SA-010 | Improve | P2 | **Avoid redundant recall from overlapping summaries.** A recap and its underlying events do not repeatedly spend the same allowance on the same information. |
| SA-011 | Improve | P2 | **Tune carryover across replies and scene changes.** Useful context persists within a scene and stops when location, time, branch, or speaking character makes it inappropriate. |
| SA-012 | Add | P2 | **Provide a 'Test this question' recall preview.** Users can inspect candidates, exclusions, selected details, and source links before generating a roleplay reply. |


### Extraction and memory accuracy

Current foundation: chat, archive, or combined extraction; reviewed additions; exact-repeat removal; scene-break suggestions; and buffered rolling memories.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-013 | Improve | P1 | **Choose scene boundaries from story structure.** Automatic suggestions respect scene transitions and the newest-message buffer without splitting a consequential exchange arbitrarily. |
| SA-014 | Improve | P1 | **Offer explicit levels of extraction detail.** Users can choose compact, standard, or detailed preservation and see the effect on the same demonstration scene. |
| SA-015 | Improve | P1 | **Preserve consequential subtext and small observations.** Extraction retains evidenced emotional shifts, habits, motivations, and private observations when they affect later play. |
| SA-016 | Improve | P1 | **Attach provenance to individual memory bullets.** Each new event retains the source messages that support it even after lists are combined, condensed, or exported. |
| SA-017 | Add | P1 | **Audit proposed memories against their evidence.** A separate optional quality check identifies omitted important facts and unsupported additions without silently rewriting canon. |
| SA-018 | Improve | P1 | **Distinguish dialogue, narration, thought, and author notes.** Attributed claims remain attributed, private thoughts keep their audience, and explicit author corrections follow the chosen canon policy. |
| SA-019 | Improve | P1 | **Extract changes without reprocessing complete lists.** Routine additions use an index of existing information and preserve untouched memories without repeatedly sending every old sentence. |
| SA-020 | Improve | P2 | **Detect duplicates expressed in different words.** A reviewed duplicate suggestion recognizes paraphrases while preserving separate dates, experiences, and perspectives. |
| SA-021 | Improve | P2 | **Separate duplication from a genuine change of fact.** A lost coat, an earlier owned coat, and a rumor about that coat are not collapsed into one timeless fact. |
| SA-022 | Improve | P1 | **Accept scenes with no new durable memories.** The model can return a valid empty result with a reason; the workflow does not manufacture an event to satisfy a schema. |
| SA-023 | Improve | P1 | **Validate incomplete and malformed model output.** Required subjects, sources, and fields are checked; bounded repair retains usable prepared work and exposes remaining failures. |
| SA-024 | Improve | P2 | **Adapt extraction to weaker or local models.** A simpler supported output format produces useful memories without requiring tool calls, embeddings, or a large reasoning model. |


### Character knowledge and identity

Current foundation: roster aliases, card identities in groups, persona opt-in, knowledge states, learning dates, and a knowledge-as-of-date view.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-025 | Improve | P1 | **Keep character and NPC identities stable.** Two characters sharing a display name remain distinct through renames, imports, groups, and source reconstruction. |
| SA-026 | Improve | P2 | **Preview alias and identity merges completely.** A merge shows all affected memories, knowledge, keywords, and destinations and can be reversed without losing originals. |
| SA-027 | Improve | P1 | **Track how each character learned each fact.** Witnessing, being told, inference, and rumor remain distinguishable on individual memories. |
| SA-028 | Improve | P1 | **Expose knowledge changes over time.** An earlier belief and a later revelation can both be inspected, and an earlier scene receives the correct state. |
| SA-029 | Improve | P2 | **Model secrecy audiences and information transfer.** A witnessed disclosure changes the appropriate characters' knowledge; mere co-presence does not automatically grant knowledge. |
| SA-030 | Verify | P0 | **Test uncertainty and false-belief handling.** False beliefs require evidence of falsity, and an uncertain narrator claim is not promoted to confirmed fact. |
| SA-031 | Improve | P1 | **Make retcons easy to review and apply.** Users can distinguish correcting the record from an in-story change, with dependent proposals and history visible in one review. |
| SA-032 | Add | P3 | **Track evidenced changes in personality and worldview.** Optional development notes cite the events behind a change and allow intentional character growth instead of enforcing a frozen baseline. |
| SA-033 | Verify | P0 | **Enforce persona inclusion settings everywhere.** Archive, memory, diary, helper, import, and automation paths consistently honor the user's persona choices. |
| SA-034 | Verify | P0 | **Stress-test knowledge isolation across speakers.** Group, recap, fallback, and tool paths are checked for wrong-character knowledge and future-information leakage. |


### Chronology, timelines, and story structure

Current foundation: dated units, retroactive entries, learning dates, explicit flashbacks, open threads, a Library timeline, and branch lineage.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-035 | Improve | P1 | **Separate calendar dates from archive unit numbers.** Changing Day, Chapter, or Session labels does not imply a new event date or renumber established chronology. |
| SA-036 | Improve | P1 | **Represent incomplete dates honestly.** Unknown years and approximate times stay explicit instead of becoming precise invented timestamps. |
| SA-037 | Add | P3 | **Support configurable fictional calendars.** A story can define its own months, seasons, or unit mapping without breaking ordinary Gregorian dates. |
| SA-038 | Improve | P2 | **Resolve relative dates only from known anchors.** Phrases such as 'two days later' use a verified anchor and preserve uncertainty when more than one anchor is possible. |
| SA-039 | Improve | P1 | **Show event time separately from revelation time.** A newly revealed childhood event appears in its historical place and remains linked to when each character learned it. |
| SA-040 | Improve | P2 | **Make flashback and return-to-present controls explicit.** A user can select scene time without relying solely on textual markers, and the active cutoff is visible. |
| SA-041 | Add | P3 | **Link causes and consequences between events.** Optional links represent evidenced causality and can answer why something changed without inventing motivations. |
| SA-042 | Add | P3 | **Offer a useful event or relationship graph.** A graph opens the same evidence and edits as the list view and is retained only if it improves real navigation tasks. |
| SA-043 | Improve | P2 | **Develop open threads into a clear lifecycle.** Promises, goals, clues, and deadlines can be opened, advanced, resolved, abandoned, or explicitly contradicted with evidence. |
| SA-044 | Improve | P2 | **Compare parent and branch histories.** Users can inspect the fork point and subsequent differences without mixing later events into the earlier branch. |


### Little Things, relationships, objects, and NPCs

Current foundation: reviewed Little Things, exact-source quotes, cues, audience fields, open-promise recall, trackers, and character timelines.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-045 | Improve | P1 | **Capture habits, preferences, and quiet relationship beats.** Small consequential details survive extraction alongside major plot events, with a source and a clear audience. |
| SA-046 | Improve | P2 | **Suggest useful recall cues and synonyms.** Users can review cue suggestions that reflect natural ways the detail might be referenced later. |
| SA-047 | Verify | P0 | **Keep exact quotations exact through every operation.** Capture, condensation, export, import, and branch projection preserve source-verified wording or clearly identify a paraphrase. |
| SA-048 | Improve | P2 | **Track object ownership and transfers precisely.** A handover records giver, recipient, time, and source while retaining the earlier ownership history. |
| SA-049 | Improve | P2 | **Show relationship turning points with reasons.** Relationship changes open the events behind them and distinguish each character's perspective. |
| SA-050 | Add | P3 | **Maintain an optional motif and recurring-detail index.** A user can find meaningful recurring objects or phrases without automatically injecting every appearance. |
| SA-051 | Improve | P2 | **Recall promises when they become relevant.** A callback respects fulfillment, participants, scene timing, and uncertainty rather than firing indefinitely. |
| SA-052 | Improve | P2 | **Balance continuity with repetition.** Detail carryover and cooldown settings prevent the same gift, habit, or promise from dominating successive replies. |
| SA-053 | Improve | P2 | **Extend manual cue and pin controls.** Users can queue a detail for a reply or relevant scene, expire that request, and see why it loaded. |
| SA-054 | Add | P3 | **Build reviewed supporting-character dossiers.** An NPC dossier consolidates established traits and appearances with sources and stays separate from invented new canon. |


### Reference lore and lorebook management

Current foundation: selected reference books or entries, a source-policy distinction, native World Info routing, and overflow diagnostics.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-055 | Improve | P1 | **Show reference sizes before a run.** The preview lists approximate tokens for each selected book and entry before any model request is sent. |
| SA-056 | Add | P1 | **Give references a separate allowance and priorities.** Essential entries can be pinned; optional material can be omitted through a visible preview without silently trimming required canon. |
| SA-057 | Add | P2 | **Save named reference collections.** Reusable ordered collections can be selected per story and transferred separately from private story content. |
| SA-058 | Add | P2 | **Select relevant reference passages for large books.** An optional bounded selector supplies pertinent passages with their provenance instead of always sending entire selected books. |
| SA-059 | Improve | P1 | **Keep world background separate from witnessed events.** Stable lore informs interpretation without being recorded as an event the characters experienced in the selected chat. |
| SA-060 | Improve | P2 | **Explain the impact of changed reference lore.** A changed reference can show affected derived records and prepare optional correction proposals without blocking ordinary approvals. |
| SA-061 | Improve | P2 | **Make canon precedence understandable.** Author corrections, source evidence, background lore, and character beliefs have an explicit conflict-resolution policy. |
| SA-062 | Verify | P0 | **Protect manually maintained and external lorebooks.** Generation, cleanup, import, and migrations cannot silently rewrite unmanaged entries or user-set activation rules. |
| SA-063 | Add | P3 | **Offer reviewed splitting of oversized lore entries.** Users can preview an entry split, its keywords, and backlinks and restore the original. |
| SA-064 | Improve | P1 | **Diagnose overlapping memory and lore activation.** The setup view identifies duplicate sources or competing injectors and explains the user's available choices. |


### Condensation and memory organization

Current foundation: individual-entry shortening, source-linked recaps, protected wording, token targets, and optional automatic recap triggers.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-065 | Improve | P2 | **Make multi-level recaps predictable.** Users can see which scenes feed an arc or higher recap, and each original remains reachable. |
| SA-066 | Improve | P1 | **Respond to actual token pressure.** Condensation targets eligible older material while protecting the current scene and showing the expected savings. |
| SA-067 | Improve | P1 | **Keep compressed history recoverable.** Archived originals and their links remain available to source queries and restore operations. |
| SA-068 | Add | P2 | **Let users identify enduring anchor facts.** Protected anchor facts receive deliberate priority without turning an unlimited collection into always-on context. |
| SA-069 | Add | P1 | **Check important facts before and after condensation.** An optional audit compares source facts with the result and flags losses of dates, commitments, identity, and meaningful nuance. |
| SA-070 | Improve | P2 | **Offer readable compression profiles.** Users can choose compact or detailed results and compare token savings without a claim of guaranteed lossless summarization. |
| SA-071 | Improve | P1 | **Preserve emotional meaning during shortening.** Condensation keeps evidenced motivations and relationship changes while removing repetitive prose. |
| SA-072 | Improve | P2 | **Refresh retrieval metadata after approved rewrites.** Keywords, event indexes, and embeddings update consistently when the approved text changes. |
| SA-073 | Improve | P2 | **Expand from a recap to the exact supporting detail.** A detailed lookup can choose a source event instead of injecting every scene covered by the recap. |
| SA-074 | Add | P2 | **Explain whether a proposed recap is worthwhile.** The preview compares expected context savings with the calls needed and avoids repeatedly proposing negligible reductions. |


### Model routing, jobs, and automation

Current foundation: per-stage profiles, a resumable queue, combined reviews, partial-result recovery, explicit splitting, and opt-in automation.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-075 | Fix | P0 | **Make helper profile fallback consistent and explicit.** A failed selected helper profile does not switch to the chat model unless the configured fallback policy permits it; the actual route is visible. |
| SA-076 | Improve | P1 | **Make Stop and cancellation behavior truthful.** Requests are aborted where the host supports it; otherwise the UI states that the active request must finish and prevents later commits. |
| SA-077 | Improve | P1 | **Bound timeouts, retries, and rate-limit recovery.** A retry policy has finite attempts and delays, exposes the reason, and never silently repeats successful writes. |
| SA-078 | Improve | P1 | **Show understandable progress for every stage.** The job view identifies the current stage, elapsed time, completed work, model route, and available recovery action. |
| SA-079 | Verify | P0 | **Prove that retry repeats only failed work.** Fault-injection tests cover provider failures and crashes between every save and receipt or cursor update. |
| SA-080 | Verify | P0 | **Keep successful prepared results editable after failure.** A later failure or canceled review preserves earlier proposals without forcing their generation again. |
| SA-081 | Improve | P0 | **Add automatic checkpoints for consequential rewrites.** Bulk changes have a restorable checkpoint, and resume after reload uses verified book and source identities. |
| SA-082 | Improve | P1 | **Schedule background work around stable chat.** Extraction waits for stable messages, honors buffers and edits, and gives active user operations priority. |
| SA-083 | Improve | P2 | **Offer clear review policies for automation.** Manual, prepare-for-review, and explicitly enabled automatic policies state what may write and what remains pending. |
| SA-084 | Improve | P2 | **Prevent repeated automatic maintenance.** Cooldowns and content signatures stop recap, extraction, and audit jobs from cycling over unchanged material. |
| SA-085 | Improve | P1 | **Manage deferred proposals in one place.** Users can return to, edit, approve, or discard pending work with its source and impact visible. |
| SA-086 | Add | P3 | **Let model tools prepare proposed lore changes.** A capable model can propose create/update operations through bounded tools; approval and undo use the normal reviewed workflow. |


### Interface, themes, mobile, and accessibility

Current foundation: everyday and advanced views, built-in help, native-theme Memory Trail, movement controls, mobile sheets, and message actions.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-087 | Improve | P1 | **Guide users to their first verified memory.** Setup creates or selects the right book, checks the chosen connection, runs a small range, and shows the saved result. |
| SA-088 | Improve | P1 | **Provide Simple, Detailed, and Mostly Automatic presets.** Presets configure existing controls together and explain extra calls, review behavior, and memory allowances. |
| SA-089 | Improve | P2 | **Make every action discoverable from one search.** An action search can locate commands and settings and open the appropriate control without requiring the user to know its tab. |
| SA-090 | Improve | P1 | **Use consistent names and explanations.** The same action and feature have the same name in buttons, help, messages, screenshots, and release notes. |
| SA-091 | Improve | P1 | **Keep one clear primary action per common task.** The everyday view covers archive, remember, inspect, and recover with advanced choices available when useful. |
| SA-092 | Verify | P0 | **Test every panel against live SillyTavern themes.** Light, dark, solid, transparent, blur, font size, contrast, and Fast UI changes do not break readability or native chat layout. |
| SA-093 | Improve | P2 | **Remember Memory Trail placement appropriately.** Desktop positions can persist per device or layout, with an obvious reset and sensible mobile behavior. |
| SA-094 | Verify | P0 | **Keep movable windows on screen.** Browser zoom, viewport changes, orientation changes, and changed Moving UI positions cannot strand controls outside the viewport. |
| SA-095 | Improve | P2 | **Unify dock, popup, and sheet interactions.** Opening and closing views restores focus and uses consistent actions across desktop and touch layouts. |
| SA-096 | Verify | P0 | **Complete keyboard and screen-reader coverage.** Controls have useful labels, focus order, visible focus, touch targets, and status announcements without relying on color alone. |
| SA-097 | Improve | P2 | **Explain message coverage without clutter.** Optional badges distinguish archived, skipped, changed, and pending material without moving the message layout. |
| SA-098 | Add | P2 | **Offer compact inline memory previews.** A message can reveal its linked event and quick actions in place while the full Library remains available. |


### Cost, context, and diagnostics

Current foundation: run estimates, a request/token meter, model-capacity checks, Memory Trail reasons, and oversized-input breakdowns.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-099 | Add | P1 | **Explain the whole prompt's token allocation.** A compact view separates instructions, cards, examples, chat history, lore, and managed memories where the host exposes them. |
| SA-100 | Improve | P0 | **Show the configured and actual model route.** Tests and completed operations identify which profile served them and expose fallback instead of presenting it as success on the selected profile. |
| SA-101 | Improve | P1 | **Include all optional work in run estimates.** Reference selection, recall, validation, retry allowances, and enabled stages are represented before the user starts. |
| SA-102 | Improve | P2 | **Use provider usage when available and label estimates.** Reported input/output/cached usage is distinguished from local tokenizer estimates; unavailable billing data is not invented. |
| SA-103 | Add | P2 | **Offer optional spending estimates from user-set rates.** A user can supply prices and currency, and the view clearly separates estimated cost from actual billed usage. |
| SA-104 | Improve | P1 | **Apply session allowances to automatic work.** Automatic jobs stop or wait when user-set token or request allowances are exhausted and preserve pending work. |
| SA-105 | Improve | P1 | **Cap calls per reply and time interval.** Tool loops, repeated failures, and automation bursts are bounded across all helper paths. |
| SA-106 | Improve | P2 | **Make cache information useful and accurate.** Stable-prefix estimates are labeled as estimates; actual cache savings are shown only when the provider reports them. |
| SA-107 | Improve | P1 | **Record useful request and recall traces.** A trace links the selected sources, omissions, model route, allowance, and failure reason without claiming that inclusion proves model use. |
| SA-108 | Improve | P1 | **Export diagnostics with a privacy preview.** Users can share version and error information after reviewing redactions of story text, credentials, and identifying details. |


### Speed and scale

Current foundation: token caching, filtered Library views, request batching within archive stages, and bounded recent reply traces.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-109 | Improve | P1 | **Update search indexes incrementally.** An edit or new event updates affected entries without rebuilding every book's searchable representation. |
| SA-110 | Improve | P2 | **Persist rebuildable search indexes.** Reloads can reuse a versioned index whose authoritative source remains the native saved story data. |
| SA-111 | Verify | P0 | **Invalidate caches after every relevant change.** Text, identity, branch, settings, tokenizer, and embedding changes cannot leave stale recall or token counts. |
| SA-112 | Improve | P1 | **Virtualize very long Library and timeline views.** Large collections remain fully reachable while only a small visible portion is rendered. |
| SA-113 | Improve | P1 | **Bound token-counting work and cache size.** Counts are reused for identical text and tokenizer settings, and old cache entries have a clear eviction policy. |
| SA-114 | Verify | P0 | **Avoid duplicated listeners and unnecessary renders.** Opening chats, reopening panels, and changing settings do not multiply handlers or trigger hidden rendering work. |
| SA-115 | Add | P3 | **Move expensive local processing off the main thread.** A worker or equivalent scheduling keeps typing and scrolling responsive where profiling proves a benefit. |
| SA-116 | Improve | P2 | **Batch and reuse embedding work.** Only changed content is re-embedded, with bounded concurrency, cancellation, and transparent index status. |
| SA-117 | Improve | P2 | **Expose storage and history growth.** Users can inspect footprint and choose a retention policy that never silently removes protected originals or revisions. |
| SA-118 | Verify | P1 | **Publish performance measurements at increasing sizes.** Load, search, selection, scrolling, and saving are measured on documented hardware with 1,000, 10,000, and larger record sets. |


### Compatibility, imports, sharing, and extensibility

Current foundation: native World Info, optional integrations, workflow/story imports, Markdown exports, private branches, and intentional archive sharing.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-119 | Verify | P0 | **Publish a tested SillyTavern capability matrix.** Supported releases, Chat Completion, Text Completion, profiles, vectors, and tool calling have explicit tested outcomes. |
| SA-120 | Verify | P0 | **Keep the basic workflow usable without optional services.** Core archiving, review, and ordinary memory use work without embeddings, function calling, or an extra server plugin. |
| SA-121 | Verify | P0 | **Preserve native World Info semantics.** Filters, recursion, probability, sticky behavior, user overrides, and other injectors behave as documented alongside managed budgeting. |
| SA-122 | Add | P2 | **Import Memory Books through a guided preview.** Supported summaries and metadata map visibly into records, and missing original provenance is never fabricated. |
| SA-123 | Add | P3 | **Import qvink or InlineSummary memories carefully.** Supported versions preserve nested originals and message identities and offer a reversible preview. |
| SA-124 | Improve | P2 | **Support bulk memory import with field mapping.** Markdown, JSON, and optional tabular inputs can map subjects, dates, sources, and types through validation and review. |
| SA-125 | Improve | P1 | **Make exports portable and round-trip tested.** A versioned story export preserves IDs, dates, protections, sources, revisions, Little Things, and supported pending work. |
| SA-126 | Verify | P0 | **Test branches, copies, renames, and imported chats.** A separate timeline gets the right private history and never claims later or unverifiable evidence as its own. |
| SA-127 | Improve | P2 | **Detect conflicting shared-story writers.** Competing edits are detected before overwrite, and limits of available server-side coordination are explicit. |
| SA-128 | Add | P3 | **Document a small stable integration interface.** Other extensions can read supported memory data, request lookups, or prepare proposals through versioned, scoped hooks. |


### Quality, recovery, and releases

Current foundation: 43 workflow and behavior tests, syntax checks, verified save reads, revisions, and previous live checks on SillyTavern 1.19.0.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-129 | Add | P0 | **Build a public synthetic memory benchmark.** A reusable story corpus has known answers and source ranges and covers short, long, and branching stories. |
| SA-130 | Add | P0 | **Measure extraction omissions and invented facts.** Evaluation checks what was preserved, lost, or unsupported separately from formatting and workflow success. |
| SA-131 | Add | P0 | **Measure retrieval quality under fixed allowances.** Tests quantify relevant evidence found and irrelevant evidence included at equal context and recent-chat budgets. |
| SA-132 | Add | P1 | **Evaluate the final reply with real models.** An explicitly run bounded evaluation checks factual answers, perspective, and citation support rather than only retrieval output. |
| SA-133 | Verify | P1 | **Test multilingual and mixed-language story quality.** Arabic, Darija, French, English, transliteration, and selected unspaced scripts are tested for extraction and recall, beyond token counting. |
| SA-134 | Verify | P0 | **Simulate interrupted and partially saved operations.** Network loss, reload, cancellation, chat changes, malformed replies, and failed multi-book writes leave recoverable state. |
| SA-135 | Verify | P0 | **Automate meaningful visual regression checks.** Theme, layout, mobile, zoom, and coexistence fixtures catch chat disruption and inaccessible controls before release. |
| SA-136 | Improve | P0 | **Run relevant checks automatically on pull requests.** Syntax, imports, unit tests, meaningful integration tests, and version consistency checks run on the proposed commit. |
| SA-137 | Verify | P1 | **Measure the extension's own overhead.** Idle, typing, ordinary replies, archive jobs, and retrieval have separate timing and memory measurements. |
| SA-138 | Verify | P1 | **Test representative desktop and mobile setups.** Supported browsers, operating systems, low-memory devices, and relevant mobile hosts have a documented verification matrix. |
| SA-139 | Verify | P0 | **Test migrations and hostile or damaged imports.** Saved custom prompts survive upgrades; schema validation, rendered text escaping, and malformed imported data have regression coverage. |
| SA-140 | Improve | P0 | **Use a repeatable release and rollback process.** The tested commit, version files, tag, changelog, release notes, upgrade checks, and recovery instructions agree. |


### Documentation, adoption, and community

Current foundation: illustrated README, invented example story, walkthroughs, in-app help, searchable button guide, and GitHub releases.

| ID | Kind | Priority | Proposed result and completion criterion |
| --- | --- | --- | --- |
| SA-141 | Improve | P1 | **Make the first successful workflow a two-minute guide.** A new user can install, save one memory, and verify its recall using a short invented example. |
| SA-142 | Improve | P2 | **Publish a few tested setup recipes.** Long fiction, groups, RPG tracking, local models, and low-cost hosted setups each have a concise recipe with clear tradeoffs. |
| SA-143 | Improve | P1 | **Explain model requirements through capability checks.** Connection tests identify required output and tool support on the selected route and explain a usable fallback. |
| SA-144 | Add | P1 | **Provide a guided 'Why was this forgotten?' flow.** The tool distinguishes missing extraction, missing activation, budget exclusion, source mismatch, and information the model received but ignored. |
| SA-145 | Improve | P1 | **Keep help and upgrade guidance synchronized.** Screenshots, troubleshooting, labels, compatibility notes, and migration instructions match the released build. |
| SA-146 | Add | P2 | **Prepare the interface and help for translation.** User-facing strings are externalized and tested with at least one longer-text and one right-to-left language. |
| SA-147 | Add | P2 | **Publish fair, reproducible comparisons.** Benchmarks state models, prompts, budgets, hardware, versions, limitations, and raw results without unsupported superiority claims. |
| SA-148 | Add | P2 | **Submit Scene Archivist to the official extension catalog.** A complete catalog submission follows the project's current contribution process; acceptance remains the maintainers' decision. |
| SA-149 | Improve | P1 | **Make bug reports and feature feedback actionable.** Templates request version and reproducible steps, support reviewed diagnostics, and provide visible issue status without automatic data collection. |
| SA-150 | Improve | P2 | **Show distinctive features in a short polished demo.** An invented story demonstrates a small remembered detail, an original-source answer, a safe correction, and recovery after interruption. |

## Research sources and what they contributed

The backlog is original engineering and product analysis. The following projects supplied comparative examples, not independently verified performance guarantees.

| Source | Lesson used |
| --- | --- |
| [Memory Books user guide](https://github.com/aikohanasaki/SillyTavern-MemoryBooks/blob/main/USER_GUIDE.md) | Scene memories, reference collections, character-focused books, and tiered consolidation provide close workflow comparators. |
| [Summaryception](https://github.com/Lodactio/Extension-Summaryception) | Recursive compression offers a model for reducing routine memory maintenance. Claims of perfect preservation were not used as measurements. |
| [VectFox](https://github.com/KritBlade/VectFox) | Structured events and combined lexical/semantic retrieval inform granularity and candidate selection. Backend performance claims were not independently tested. |
| [Timeline Memory](https://github.com/unkarelian/timeline-memory) | Its original-chapter query mechanism is an example of recovering details absent from a summary. |
| [TunnelVision](https://github.com/Coneja-Chibi/TunnelVision) | Model-driven lore operations illustrate possible advanced tools; this roadmap routes proposed writes through review and recovery. |
| [Smart Memory](https://github.com/senjinthedragon/Smart-Memory) | Knowledge states, entity state, deduplication, and fact retirement are existing competitive capabilities. |
| [Smart Memory test harness](https://github.com/senjinthedragon/Smart-Memory/blob/main/test-harness.mjs) | Fictional fixtures, assertions, and optional live extraction are useful evaluation patterns. |
| [CharMemory](https://github.com/bal-spec/sillytavern-character-memory) | Guided setup, health checks, and wider prompt visibility are usability comparators. |
| [Continuity Memory](https://github.com/scatteredlilies2020/Continuity-Memory) | Background processing and fewer lorebook-management steps demonstrate an alternative user experience. |
| [qvink MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize) and [InlineSummary](https://github.com/Kristyku/InlineSummary) | Message-level control, inline inspection, and restoration can reduce navigation. |
| [Chaotic Lorebooks](https://github.com/XaYS-101/Chaotic-lorebooks-Silly-Tavern) | Mode presets are an example of packaging complexity behind a small set of understandable choices. |
| [SillyTavern extension development](https://docs.sillytavern.app/for-contributors/writing-extensions/), [function calling](https://docs.sillytavern.app/for-contributors/function-calling/), and [World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) | Integrations must be capability-aware and coexist with native behavior. |
| [Official extension catalog](https://github.com/SillyTavern/SillyTavern-Content/blob/main/extensions.json) | A maintained discovery route to pursue through its contribution process. |
| [Reddit: Which memory extensions to use?](https://www.reddit.com/r/SillyTavernAI/comments/1sgwjrx/which_memory_extensions_to_use/), [TunnelVision vs Memory Books](https://www.reddit.com/r/SillyTavernAI/comments/1slkx4x/tunnelvision_vs_memory_books/), and [long-chat summarization discussion](https://www.reddit.com/r/SillyTavernAI/comments/1wnydne/summaryception_memory_books_etc_whats_the_best/) | Individual reports motivate easier setup, preserving nuance, and predictable waiting/cost. They are not current bug verdicts or a representative user survey. |

## Product guardrails

- Preserve exact author choices, original sources, recoverable history, and existing saved custom prompts.
- Keep the normal workflow useful without an embedding service, server plugin, or tool-capable model.
- Add advanced automation through explicit settings and visible allowances.
- Use native theme and layout behavior throughout the extension.
- Make uncertainty, model routing, and recovery understandable.
- Promote optional features when real tasks or benchmarks show a benefit.
- Keep all 150 entries as planning items until their stated completion criteria are demonstrated.

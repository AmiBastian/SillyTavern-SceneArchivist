# Changelog

## 1.0.3 · October 21, 2026

- Removed automatic full-text archive retrieval from chat injection. Shared names, dates, ordinary words, titles, metadata, and body text no longer qualify entries outside native World Info rules.
- Removed the override that stripped entry keys, made selected records constant, reset probability and sticky settings, and bypassed native activation checks.
- Native World Info now completes its own keyword, vector, secondary-key, depth, recursion, probability, group, cooldown, and delay checks before the archive budget trims the activated story entries. Pins affect priority only.
- Removed automatic vectorization of all story entries. Native Vector Storage and each entry's vector flag control eligibility, including native Enabled for all when explicitly configured there.
- Replaced body-word evidence with observed native activation sources: keywords, vectors, Always On, Sticky, explicit Recall/details, decorators, or unidentified external activations. Native vector activation does not prove a simultaneous keyword match.
- Vector diagnostics run independently of the retired Scene Archivist semantic switch and preserve the native requests and responses. Quiet helpers, previews, chat changes, and recursion-step limits are covered by regression tests.

### Updating

Replace the contents of the existing extension folder with this release and reload SillyTavern. Keep the existing installation's `.git` directory if it was installed through ST. No archive or keyword rewrites are required. Configure World Info vectors in native Vector Storage and the entries' own vector settings, then send a normal reply and open **Search → Memory budget and loading reasons**.

### Validation

Run `npm test`. Offline tests execute unmodified excerpts of SillyTavern's native World Info scanner, matching buffer, sorting, inclusion groups, and vector activation code, with browser persistence and provider I/O stubbed. They cover keyword-only activation, body-overlap exclusions, native eligibility, filters, recursion, budget trimming, explicit Recall/details, report isolation, and vector request errors. These checks do not use a live embedding provider or Mira's laptop installation.

## 1.0.2 · October 21, 2026

- Added native vector search status to **Memory budget and loading reasons**, including Google AI Studio/model identification, successful searches, zero matches, disabled settings, unobserved searches, and request errors.
- Records now show all selection reasons together, including simultaneous vector and text matches. Expandable evidence lists the actual matched text words.
- **What the model saw** reuses the recorded reasons instead of labeling temporarily constant, budget-selected records as always on.
- Text retrieval now matches whole words and ignores common English function words. Short fragments such as `a` or `he` no longer match across nearly every archived entry. Names, dates, accents, and supported non-Latin word segmentation remain searchable.
- Background and quiet helper generations preserve the normal reply's vector evidence. Unrelated force-activation events are not treated as vector matches.
- Added separate World Info activation confirmation and a count of story entries that ST activated outside the managed selection.

### Updating

Replace the files in the existing Scene Archivist installation and reload SillyTavern. Include the new **`vector-diagnostics.js`** file. Send a normal chat reply, then open **Search → Memory budget and loading reasons**. Existing archive content and memories are not rewritten by these changes.

### Validation

Run `npm test` with Node.js. Regression checks cover whole-word retrieval, combined reasons, memory limits, recap coverage, simulated native vector requests and activation events, quiet generations, chat isolation, response preservation, errors, and interoperability with another fetch hook. These checks simulate the SillyTavern host; they do not verify a live Google API key or a laptop installation.

## 1.0.1 · October 20, 2026

Bulk jobs now process the full selection before showing one combined review. No more approving every character individually.

- Added **Together at the end**, the default bulk review mode. **After each step** remains available in Story memory settings.
- Character-memory audits and condensation group up to **4 characters per request by default**, with a configurable limit of 1 to 8. Groups shrink to fit the input limit, while exceptionally long lists retain their chunk-and-merge workflow.
- Applied combined review to new memories and their follow-up audit, scene-summary passes, archive condensation, structured fact/knowledge extraction, and tracker updates.
- **Archive thoroughly** prepares its archive, memory, audit, and enabled tracker stages before one combined review.
- Restored **Lists longer than** and made character-memory condensation honor the threshold. Full memory organization still includes shorter eligible lists.
- Prepared results survive pause, canceled review, and reload. Reopening a completed proposal does not repeat its model requests.
- Story books remain unchanged until approval. Partial-write retries retain receipts, memory coverage is saved after the character books, and Undo restores the whole bulk write.
- Updated progress messages, Undo availability, documentation, and workflow preset handling. Added regression tests and two screenshots of the new controls.

### Updating

Replace the files in the existing Scene Archivist installation with this release and reload SillyTavern. Include the new **`bulk-jobs.js`** file. Finish or cancel remaining steps in an old 1.0.0 job before starting a new run; old jobs retain their original review behavior. Existing memories and archive books stay in place.

### Validation

Automated suites cover the existing archive behavior and the new batching, date/identity validation, threshold, review, source-edit, serialized recovery, and partial-write cases. Browser checks exercise the actual interface against a simulated SillyTavern host, including 33 character lists, canceled-review recovery, whole-run Undo, and the full archive workflow. The 33-character fixture used nine scripted model requests and one combined review; actual request counts depend on list sizes and input limits. No live provider call is part of these checks.

## 1.0.0 · October 19, 2026

Initial public release.

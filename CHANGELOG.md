# Changelog

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

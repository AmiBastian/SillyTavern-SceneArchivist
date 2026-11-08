# Related queries and verified original passages

Private batch based on `develop` commit `9b0d5a157a12315e78a571cfb912058f8446b9c1`, developed on `verified-source-recall`. This advances SA-003, SA-006, SA-007 and SA-008 without completing the recall milestone or changing public 2.0.1.

## Question flow

Ask first packs saved evidence. If none fits, it can search verified source passages directly. With no lexical matches, the first helper response can propose search rewrites rather than invent an answer. An insufficient answer can supply up to three rewrites of at most 200 characters. Literal and rewritten searches have independent routes into a shared 100-candidate shortlist through reciprocal rank fusion.

An insufficient answer or empty source list triggers at most one retrieval follow-up. It combines related saved evidence with original passages only when the evidence set changes. Reordering the same evidence does not spend another request. The second pass must acknowledge unresolved gaps. Existing JSON repair allows one retry per answer pass, so a question uses at most four provider requests including repairs, normally one or two. A failed selected helper is reported, never silently replaced by another route.

Search rewrites are hints, not new facts. Answers must use supplied source ids, and inline citations must agree with their source list. This checks citation identity, not semantic entailment of every claim. No embedding model, vector store or new persistent schema is introduced. The existing native vector path and pre-generation AI Recall remain separate.

## Source limits and exclusions

- Only receipts for the current logical source chat and active story are eligible. Every index in a range must appear exactly once in order, and sender, role and message hashes must still match. No other chat is loaded. Partial receipts cannot establish a continuous exchange.
- Foreign, disabled, retired and branch-disabled parents are excluded. Original lookup applies an active Scene Recall flashback cutoff to the parent. Ask's saved-record search remains author-facing rather than a character knowledge view.
- Explicit author corrections, unresolved external edits and unrecognized content-changing revisions veto overlapping source passages, including duplicate receipts in another record. Known automatic list/layout revisions are allowed. Manual text edits through Inspect now append explicit author-correction metadata. Older ambiguous revisions are handled conservatively.
- Local work is capped at 1,000 records, 2,000 receipts, 4,000 message receipts and 1,000,000 message/name characters. If correction coverage cannot be checked within those bounds, raw lookup fails closed. Limits and skipped receipts appear in the answer view. This is a bounded search, not proof no other evidence exists.
- Passages contain up to five complete messages, with two-message overlap between chunks. Ranking removes overlapping matches before budget packing. Citation wrappers count toward the helper allowance; oversized messages are never cut to manufacture a fitting answer. System-message windows are excluded. A complete window can still omit necessary wider context.
- Passages are reverified after token counting, after the model response and before a source jump. Context, archive and generation changes discard in-flight results. Source buttons close the workspace through the existing host jump API.

Tools accept alternate wording while retaining parent speaker and flashback rules. They still read saved records only. A character-owned memory's source range does not establish that every thought or statement in that range is available to that character; raw fallback is not exposed to roleplay tools in this batch.

## Validation

Run `npm test`, `npm run check`, and `npm run benchmark -- --check`. The source comparison reuses unchanged Ember Station records, original messages and questions. Source-enabled candidate coverage improves delivered hit from 15/21 to 17/21 under the tested allowances. Four manually scripted rewrites exercise the independent candidate path and make all 21 labeled passages available. Those rewrites are not measured model outputs or a 100% answer-accuracy claim. The evaluator exposes sources unconditionally to measure availability; runtime Ask follows up only when needed.

The optional `scripts/smoke-recall.mjs` uses a separate local SillyTavern test profile. It writes synthetic QA worlds, chat and settings into `SA_SMOKE_DATA_ROOT`; use a disposable profile with the built-in `default_Seraphina.png` character. Start the host with that same `--dataRoot`, install this checkout as `SceneArchivist`, and provide Playwright through `SA_PLAYWRIGHT_MODULE` (or an installed `playwright` package), optional `SA_CHROMIUM_PATH`, and `SA_TEST_URL`. `SA_SMOKE_SCREENSHOT` optionally captures the answer view. All generation responses are intercepted locally.

The browser smoke checks extension mounting, the real question button, a source follow-up, original-message jump, related wording, mobile results and page errors. Real provider wording, answer quality, competing extensions, normal-reply source injection and all combinations of themes or group sessions require further validation before public release.

Local validation on Node 24.22.1 passed all 109 tests, syntax and local import checks for all 52 JavaScript files, release metadata consistency and all 24 benchmark cases. The real-host smoke passed on SillyTavern 1.19.0, including desktop/mobile answer views and the original-message jump, with four stubbed generation responses and no page errors or provider calls. Hosted Node 22 and 24 checks must pass before private integration.

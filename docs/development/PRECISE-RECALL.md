# Precise recall: first list-excerpt batch

Based on private `develop` commit `5a60fd792fa3ff3fba3f854994d2ef115eb41396`, developed on `precise-memory-recall`. This is partial work toward SA-001, SA-009 and SA-010, with a saved-text citation foundation for SA-007. It does not complete the recall milestone or change the public 2.0.1 release. SA-016 still requires per-bullet original-message provenance.

## Behavior

- Ask the archive and the optional recall-memory tool search complete top-level bullets in recognizable memory lists. Date headings, nested bullets, and indented continuations stay with each selected bullet. A single bullet, prose, unknown headings, fenced code, ambiguous global qualifiers, and memory records with coverage edges remain whole.
- The view is read-only. No lorebook entries, content, revisions or original source receipts are changed. Each excerpt has a query-independent id derived from its parent id, parent content fingerprint and starting line. Changing the parent text invalidates the view. These ids identify saved-text excerpts, not independently verified chat events.
- Candidate scoring adds matched-term rarity so a common character name cannot crowd a rare topic word out of the first 100 Ask candidates. Up to 30 candidates receive explicit-detail priority. The allocator accepts that computed ranking rather than scoring the same text again; callers without it retain existing behavior.
- Ask counts the complete evidence wrappers through the host tokenizer with the existing local fallback and cache. Packing retains the helper allowance and recap/detail overlap checks. Evidence used shows the supplied text; citation buttons resolve to the real parent record. HTML text and source ids are escaped.
- Tool lookups check active/disabled state, card scope and the active Scene Recall flashback cutoff on the original record before splitting. A mixed future/past parent stays excluded in a flashback, even if one bullet looks old enough. The tools also recheck chat, speaker and generation identity after loading books.
- Tools retain their 4,800-character response allowance, select at most three matches and return complete blocks. Oversized matching evidence, including a saved story unit, receives an explicit allowance notice instead of a cut prefix. Ask remains an author-facing search across the active story's books, rather than a character's private view.
- Parsed boundaries are cached for at most 128 documents and 1,000,000 content characters, keyed by story, book, record id and registered unit vocabulary. Content equality is checked; current metadata and scope are rebuilt on every lookup. Chat opening clears this cache. The tokenizer cache remains the existing bounded host-keyed cache.

## Validation

Run `npm test`, `npm run check`, and `npm run benchmark -- --check`. Regression checks cover deep retrieval, full uncertainty qualifiers, nested notes, dates and custom units, CRLF, ambiguous-layout fallback, edits, metadata changes, bounded cache reuse, disabled/retired/branch records, card identity, flashbacks, recap overlap, wrapper costs, large bullets, large saved units, citation validation and parent buttons.

The first fixture's query-level results are unchanged. The [separate long-list comparison](../../benchmarks/README.md) improves delivered hit from 1/15 to 11/15 under the same tested allowances and loads both required records for its multi-record question. It still exposes indirect-query misses, oversized prose and lexical candidates for one unknown question. There are no model or embedding calls in either benchmark.

Local validation on Node 24.22.1 passed all 88 tests, syntax and local import checks for all 45 JavaScript files, release metadata consistency, and all 12 benchmark cases. Hosted Node 22 and 24 workflow results must also pass on the private pull request before integration.

## Limits and next work

Normal World Info injection, native vector activation and pre-generation AI Recall still operate on whole records. There is no original-scene fallback, semantic candidate union, automatic memory migration, atomic event store or per-bullet original-message verification in this batch. Complete syntactic bullets can still depend semantically on other bullets; the splitter does not infer those relationships. Live SillyTavern rendering, tool orchestration and model answer quality require host checks before public release. The optional tool must not be described as proven to improve final roleplay answers based on this offline fixture.

# Offline recall baseline

Run `npm run benchmark` for the foundation reference, long-list comparison and source/rewrite comparison below. `npm run benchmark -- --check` reproduces all three committed snapshots. `--write` records them after an intentional, reviewed change.

The fixture contains 13 curated saved records, their invented source messages, 21 answerable questions, and three questions whose answers are absent. Runs use zero or 512 routine distractors and allowances of 512 or 2,048 estimated tokens. One character memory is deliberately too large for either allowance. Queries include direct wording, indirect callbacks, attribution, object transfers, dates, exact quotations, and a multi-record cause.

The foundation evaluator retains the original whole-record `search()` and `allocate()` path and original selection settings. It records the first five lexical candidates and the first five loaded entries, the token use of the whole packed selection, hit rate, recall, precision among returned results, and reciprocal rank. Unknown questions have separate candidate counts; they are not counted as correct factual answers. Retrieval and search-cache updates leave the original fixtures and query-level results unchanged; code fingerprints are updated deliberately.

## Initial working result

| Records | Allowance | Candidate hit rate | Loaded hit rate |
| --- | --- | --- | --- |
| 13 | 512 | 17/21, 81.0% | 15/21, 71.4% |
| 13 | 2,048 | 17/21, 81.0% | 15/21, 71.4% |
| 525 | 512 | 17/21, 81.0% | 15/21, 71.4% |
| 525 | 2,048 | 17/21, 81.0% | 15/21, 71.4% |

Four indirect questions miss their supporting memory. Two additional boat questions find the large character memory but cannot fit it. These are concrete targets for finer-grained and semantic recall in the next stage. This is a small illustrative corpus; routine distractors are not a substitute for a diverse large-story evaluation.

The original 2.0.1 allocator crashed on any non-empty selection because a local `active` variable shadowed the active-record function. The recorded result is the initial working baseline after that defect was corrected, not a successful execution of the unchanged 2.0.1 allocator.

## Complete-list excerpt comparison

`fixtures/memory-lists.json` is a second, deliberately targeted fixture. Six saved memory records contain 15 answerable and three unknown questions. Three character lists contain 400 routine bullets before the labeled details; a short list, an oversized single bullet and unstructured legacy prose exercise fallback behavior. Both arms receive identical text, the same allocator, citation-wrapper costs and 100-candidate cap. One arm searches whole records; the other uses the runtime excerpt index and term-rarity weighting.

| Records | Estimated allowance | Whole-record delivered hit | Excerpt delivered hit | Excerpt evidence recall |
| --- | --- | --- | --- | --- |
| 6 | 512 | 1/15, 6.7% | 11/15, 73.3% | 73.3% |
| 6 | 2,048 | 1/15, 6.7% | 11/15, 73.3% | 73.3% |
| 134 | 512 | 1/15, 6.7% | 11/15, 73.3% | 73.3% |
| 134 | 2,048 | 1/15, 6.7% | 11/15, 73.3% | 73.3% |

Delivered hit means at least one labeled supporting passage is physically included in the packed evidence. Evidence recall counts every required passage, so the two-record question must load both password and gate evidence. Candidate hit checks the first five results; delivered coverage checks all packed evidence, matching what Ask supplies. Full bullet boundaries, including the uncertainty qualifier, are required to count an excerpt as delivered. These are evidence-availability metrics, not correct-answer rates.

Both arms still miss two indirect questions. The oversized single bullet and legacy prose remain too large because the splitter refuses to cut them arbitrarily. One unknown question names Mara and retrieves unrelated Mara evidence under the excerpt arm; this is recorded separately and shows why a lexical hit cannot establish an answer. The excerpt system prompt requires unknown answers to stay unknown, but no final model answer is evaluated here.

The targeted long-list result cannot be combined with the foundation corpus to imply an overall accuracy score. The original flat-prose boat fixture is untouched and still does not fit. `memory-lists-baseline.json` records the separate comparison with its own fixture and engine fingerprints. No competitor was run.

## Verified sources and scripted rewrites

`source-recall-baseline.json` reuses every unchanged Ember Station question, saved record and original message. Both arms count complete citation wrappers under the same 512 or 2,048 estimated-token allowances, with zero or 512 distractors. It compares saved excerpts, a source-enabled candidate pool, and that same pool with four manually supplied search rewrites in `fixtures/recall-rewrites.json`.

| Candidate pool | Delivered hit | Evidence recall |
| --- | --- | --- |
| Saved records | 15/21, 71.4% | 71.4% |
| Saved records and verified original passages | 17/21, 81.0% | 81.0% |
| Those sources and scripted search rewrites | 21/21, 100% | 100% |

These values reproduce at both allowances and corpus sizes. The original passage can fit the two boat questions whose oversized saved prose does not fit. Related coffee, key, coat and watch terms can reach independent candidate searches without literal overlap with the question. The rewrites are manually supplied test inputs, not model outputs; 21/21 is not a measured semantic-recall or answer-accuracy rate. The evaluator exposes sources unconditionally to measure availability. Runtime Ask uses its helper's sufficiency signal and allows only one follow-up, so its behavior is covered separately by workflow tests and the optional host smoke check.

Unknown questions remain unscored; none loaded candidates in this fixture. That does not prove abstention behavior on other unknowns. Historical foundation and long-list query results stay unchanged; the long-list engine fingerprint changes when retrieval helpers change.

## Scope and limitations

`performance.json` separately records local cold and repeated saved-record search at 1,000 and 10,000 records. Run `node scripts/performance.mjs` to measure the current host. These timings are not retrieval accuracy, browser rendering, provider latency or peak-memory measurements. The in-app five-question grounding check is a constrained connection smoke, not a replacement for the live-model benchmark plan.

- Saved memories are curated, not generated by an extraction model. This does not measure extraction omissions or hallucinations.
- No model or embedding provider is called. There is no API cost.
- This evaluates candidate retrieval and packing, not final answers or whether the roleplay model uses a memory.
- It does not exercise native World Info scanning, semantic vectors, group speaker rules, flashback cutoffs, or original-scene fallback. Existing behavioral tests cover some of those rules separately.
- Token costs use the local estimator. A host tokenizer can produce different packing results.
- Fixture and engine hashes make the committed snapshot attributable. Baseline changes must be reviewed alongside query-level results, not just a higher aggregate score.
- No competitor was run. These numbers cannot establish an overall ranking of extensions.

The invented fixture, evaluator, and extension use the repository's existing license. No private user story is included.

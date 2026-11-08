# Stage 1: first foundation batch

This batch is on the private `stage-1-foundations` branch, based on `develop` commit `b8813bbbcb035931ad12a48f4b03100a593ed584`. Public main and the 2.0.1 release are unchanged. The version stays 2.0.1 until a deliberate release is prepared.

## Implemented

- **SA-075, selected-profile routing:** helpers and archive stages use one tested routing module. A selected profile never falls back to the current connection automatically. Missing profiles, unavailable Connection Manager, provider failures, and empty replies fail on the chosen route.
- **SA-100, route visibility:** helper tests name the connection they contacted; diagnostics keep the last request's route and state without storing its prompt. Workbench telemetry records the selected profile and its configured name. A profile is pinned before helper token counting, so changing Settings while preflight runs cannot silently send the request elsewhere.
- **Allocator defect:** the local `active` variable in `allocate()` shadowed the active-record function and caused a ReferenceError on non-empty allocations. The variable is renamed and regression coverage checks current and retired records.
- **Recovery coverage:** tests exercise pause/reload without another generation, cancellation during a request, save receipts after a lost acknowledgement, durable metadata intent failures, read-back verification, malformed reads, journal confirmation, and Undo conflicts with later user edits. These strengthen evidence for existing recovery mechanisms; they do not introduce a new whole-story checkpoint system.
- **SA-129/131 foundation:** an invented corpus with 24 labeled questions records the current lexical candidate and budget-packing behavior, including an oversized memory and indirect references. See [the benchmark scope and results](../../benchmarks/README.md).
- **SA-138/140 foundation:** `npm run check` checks JavaScript syntax, local import paths, entry points, and version consistency. A read-only GitHub Actions workflow defines these checks, all tests, and the reproducible baseline on Node 22 and 24. Actions are pinned to verified commits.

## Local validation

- Node 24.22.1.
- All 69 tests passed, including the original three test files and an end-to-end host-fixture check of Ask the archive.
- All 39 JavaScript files passed syntax and local import-path checks.
- The saved benchmark snapshot reproduced across four combinations of corpus size and token allowance.
- No paid generation or embedding requests were made.

Hosted workflow results should be checked on the private pull request; their definition alone is not evidence that GitHub ran them.

## Remaining work

The full roadmap remains a backlog. This batch does not complete all of Milestone 1 or claim production memory accuracy. Next work includes real extraction evaluation, more diverse fixtures, host integration checks for the supported SillyTavern versions, and broader crash/save fault boundaries. Automatic whole-story checkpoints, original-scene fallback, semantic candidate union, finer memory indexing, and provider usage accounting are separate later changes.

The reported route identifies the connection profile sent to SillyTavern. A custom proxy's actual upstream model is not independently verified. The offline benchmark uses curated saved records and the fallback token estimator, not native World Info activation or live model output.

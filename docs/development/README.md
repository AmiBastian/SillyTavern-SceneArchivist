# Private development workspace

Repository: [AmiBastian/SillyTavern-SceneArchivist-Dev](https://github.com/AmiBastian/SillyTavern-SceneArchivist-Dev)

Public release repository: [AmiBastian/SillyTavern-SceneArchivist](https://github.com/AmiBastian/SillyTavern-SceneArchivist)

## Baseline

The private repository was imported from the public repository with its Git history and tags on November 8, 2026. Its initial main branch is the tested Scene Archivist 2.0.1 commit:

`ce9ac4cf571c84eff46c10ebe3e3fcb9ea784dd9`

Baseline tree: `6da90ecacd52a5a6b7c647c9b154aabb72863e9f`.

## Branches and development

- `main` keeps the imported baseline until a deliberate integration.
- `develop` is the integration branch for staged development.
- Create focused feature or fix branches from `develop` and integrate tested batches there.
- All branches in this repository inherit its private visibility.
- Public release preparation happens after the planned work is tested and ready. Transfer the chosen completed changes to the public repository for integration into its main branch.
- GitHub releases, issues, and discussions stay in their respective repositories. The Git import preserves source history and tags.

The checked-out workspace uses the private repository as `origin` and the public repository as the fetch-only `upstream`. Its default push remote is `origin`.

## Roadmap and validation

The complete backlog, priorities, completion criteria, and proposed implementation sequence are in [ROADMAP.md](ROADMAP.md). These are planning items, not claims of finished features.

The [core candidate checklist](CORE-CANDIDATE.md) tracks the integrated delivery and its actual validation boundaries. It includes the earlier [foundation](STAGE-1.md), [list excerpts](PRECISE-RECALL.md), [verified original passages](VERIFIED-RECALL.md), and the larger normal-reply delivery, provenance, audit, reference, setup, diagnostics and scale pass. The research roadmap remains separate from completed feature claims.

Run `npm test`, `npm run check`, and `npm run benchmark -- --check`. The benchmark checks the foundation reference, whole-list/excerpt comparison and separate source/rewrite availability comparison. Perform live SillyTavern checks for behavior or layout that cannot be established offline. Record the actual results for each batch.

The integrated core is included in the [2.1.0 release](../releases/2.1.0.md). Public 2.0.1 remains the historical baseline for this development record. The release notes distinguish verified integration behavior from unavailable real-model quality checks.

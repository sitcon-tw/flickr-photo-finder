# AGENTS.md

## Project Context

This repository is for building a SITCON Flickr photo finder: a lightweight photo index and future search workflow for helping SITCON organizers find usable public event photos.

The main goal is not to replace Flickr. The repository should keep a practical index layer on top of Flickr so organizers can search by real work needs such as social promotion, website visuals, sponsor proposals, sponsor fulfillment evidence, press materials, recap posts, and design assets.

## Repository Map

Use `docs/README.md` as the current documentation index, implementation status, and source-of-truth map. Do not maintain a second full artifact inventory in this file.

Key areas:

- `README.md`: human-facing project overview and quick start.
- `docs/`: architecture, workflow, data-entry, Apps Script, public frontend, GA4, and AI labeling documentation.
- `app/`: GitHub Pages and local static public finder UI.
- `apps-script/`: Google Apps Script source for Sheets-side maintenance helpers. `GeneratedConfig.js` is generated from repo schema and taxonomy.
- `config/project.json`: project-level organization, Flickr, Sheets, Apps Script, and GA4 identifiers. These identifiers are not credentials.
- `data/`: machine-readable schema, taxonomy, search aliases, validation messages, sponsorship snapshot, and AI sampling plan.
- `fixtures/`: local samples, export-format references, and validator fixtures. These files are not authoritative production data.
- `scripts/commands/` and `scripts/workflows/`: CLI tools and guided workflows. Prefer `pnpm workflow` or `docs/README.md` before invoking low-level scripts directly.
- `prompts/ai-labeling.md`: reusable AI labeling prompt template.

## Data Principles

- Google Sheets is the authoritative photo index. If Google Sheets and repo sample data disagree, Google Sheets wins.
- This repo is the governance and tooling layer: schema, taxonomy, validation, import/export scripts, Apps Script source or generators, AI prompts, and maintenance documentation.
- Keep reusable organization-specific values in `config/project.json` when practical. SITCON is the default instance, but the project should remain forkable by other organizations.
- `config/project.json` may include the public Google Sheets `spreadsheetId`. This is not treated as a secret for this project; write access is managed by Google Drive/Sheets permissions.
- Google Sheets tab names are fixed for the 1.0 workflow: `photos`, `albums`, `import_batches`, `taxonomy`, and `sponsorship_items`.
- Use the official Google Sheets API SDK as the primary direction for repo CLI operations that read or write Sheets tabs, ranges, appends, batch updates, and read-back verification.
- Do not build Google Drive file transfer flows for Sheets table semantics.
- Do not assume the current user's local authorization method, such as OAuth token caches, browser sessions, gcloud accounts, clasp login, or third-party tool sessions, will be available to other users.
- Document required capabilities, OAuth scopes, credential expectations, dry-run behavior, and verification steps separately from local credential setup.
- Treat `data/photo-schema.json` as the machine-readable source for photo, album, and import batch field order, basic field metadata, reviewed completeness rules, and approved-use requirements.
- Do not duplicate reviewed/approved field lists in docs. Reference `data/photo-schema.json` instead.
- Do not treat `fixtures/photos.csv` as production data. It exists for 1.0 demos, local UI development, validation fixtures, and future export-format tests.
- Do not treat `fixtures/albums.csv` as production data. It exists for 1.0 demos, debugging, validation fixtures, and future export-format tests.
- Treat `tmp/sheets-export/*.csv` as local work cache exported from the formal Google Sheets photo index. Do not commit it.
- The public GitHub Pages frontend is read-only. It should read Google Sheets public output data and must not contain secrets or database-write credentials.
- `photos` is the public photo index. Public CSV/JSON exports are transport formats with the same fields, not an additional filtered table.
- Album intake should start from the SITCON Flickr album catalog discovered by tools. Users should choose which discovered album to process instead of manually supplying album URLs as the primary workflow.
- GitHub Pages should be deployed through a GitHub Actions artifact, not by publishing the whole repository root.
- Apps Script should be deployed through `clasp`. Keep Apps Script source in the repo, but do not commit personal clasp credentials, Google API credentials, or tokens. `config/project.json` may record fixed Sheet-bound Apps Script IDs because they are identifiers for rebuilding local binding, not credentials. Apps Script push/status/open/deployments should resolve their target from repo config; production is the default target, and practice must be explicit.
- Treat `data/sponsorship-items.json` as a fixed snapshot. SITCON 2026 CFS has ended, so do not build auto-sync behavior for that data.
- Future CFS versions should be introduced explicitly as new or replacement versioned data, not by assuming the 2026 snapshot keeps changing.
- `sponsorship_items` should align with CFS item names. Do not invent a parallel sponsorship item vocabulary unless the documents explain why.
- SITCON is the owner of the SITCON Flickr account, but photographer credit is listed in the Flickr title when available. Do not treat Flickr oEmbed `author_name` as the photographer.
- Keep `scene_tags`, `sponsorship_items`, and `sponsorship_tags` conceptually separate:
  - `scene_tags`: visual facts in the photo.
  - `sponsorship_items`: sponsor inventory item.
  - `sponsorship_tags`: sponsor value or proof use.
- CSV multi-value fields use semicolon-separated values, for example `攤位;會眾`.
- `curation_notes` is a public curation field. Do not put sensitive internal information there.

## Agent Responsibilities

- Read `docs/agent-maintenance-guide.md` before making data workflow or AI-assist changes.
- Read `docs/project-architecture.md` before changing end-to-end workflow, deployment boundaries, or user-facing architecture.
- For Sheets table shape, read `docs/google-sheets-database-design.md` before changing Sheets or sync assumptions.
- For public AI behavior, read `docs/ai-readable-dataset.md` before changing photo index read semantics.
- For AI labeling workflow changes, read `docs/ai-labeling-operator-guide.md` and `docs/ai-labeling-contract.md` before changing tooling.
- For producing `metadata-proposals.json` inside an existing AI run, use that run directory's `ai-labeling-prompt.md` as the primary task prompt, then read `docs/ai-labeling-contract.md`, schema, taxonomy, sponsorship items, `photos.json`, and images. Do not treat `docs/ai-labeling-operator-guide.md` as required model-facing context unless the task includes operating or debugging the workflow.
- For Apps Script helpers, read `docs/apps-script-maintenance-design.md` before adding Sheets-side validation.
- Help maintain the repo so future agents can understand how to scan albums, validate data, assist AI labeling, and sync with Google Sheets.
- Do not store Google Drive, Google API, OAuth token, third-party tool, or AI API credentials in this repo.
- For organization-level access and handoff, rely on SITCON's existing documentation and Google Drive management practices rather than inventing repo-local credential rules.
- AI-generated labels may be written only as human-reviewable candidates. Keep `curation_status` semantics clear: `ai_labeled` is not the same as `reviewed`.

## Validation

Run data validation after changing local sample/export data, `data/photo-schema.json`, taxonomy files, or validation logic:

```bash
pnpm data:validate
```

The validation script currently checks:

- `fixtures/albums.csv` headers and basic album catalog fields, derived from `data/photo-schema.json`.
- `fixtures/import-batches.csv` headers and basic import batch fields, derived from `data/photo-schema.json`.
- `fixtures/photos.csv` headers for the local sample/export format, derived from `data/photo-schema.json`.
- Required photo fields.
- URL format.
- non-negative integer fields such as `people_count` and album `photo_count`.
- controlled taxonomy values.
- duplicate list values.
- controlled `priority_level` values.
- taxonomy consistency with `data/sponsorship-items.json`.

## Editing Guidance

- Keep documentation in Traditional Chinese unless there is a reason to write technical metadata in English.
- Use pnpm as the only package manager. Do not run npm or yarn commands in this repo.
- Prefer small, reviewable commits around coherent decisions or implementation slices.
- When a meaningful section is completed, suggest a commit point to the user.
- Do not add dependencies unless the benefit is concrete and documented.
- For data changes, prefer updating the source data and validation rules together when a new invariant appears.

## Useful Commands

```bash
pnpm finder:dev
pnpm eval
pnpm workflow
pnpm albums:discover
pnpm albums:list
pnpm albums:list -- --source sheets
pnpm albums:select
pnpm albums:select -- --source sheets
pnpm albums:sync -- --sheets-export <albums-csv> --output <albums-csv>
pnpm apps-script:build-config
pnpm eval:attempt -- --from <dir> --model <name> --round <number>
pnpm ai:report -- --run <dir>
pnpm ai:report -- --runs <dir> <dir>
pnpm ai:review -- --run-dir <dir>
pnpm ai:bulk:status -- --run-dir <dir>
pnpm eval:sample
pnpm ai:diff -- --run-dir <dir>
pnpm ai:plan -- --run-dir <dir>
pnpm ai:prepare -- --image-size large-1024
pnpm ai:validate -- --run-dir <dir>
pnpm eval:validate-fixtures
pnpm eval:search -- --run-dir <dir>
pnpm intake:run -- --album <album-id>
pnpm intake:validate -- --run-dir <dir>
pnpm finder:build
pnpm finder:check
pnpm photos:import -- --album <album-id> --output <photos-csv> --albums-output <albums-csv> --batch-output <batch-csv>
pnpm fixtures:album:add -- <flickr-album-url>
pnpm fixtures:album:add -- <album-id>
pnpm fixtures:photo:add -- <flickr-photo-url>
pnpm sheets:apply-init
pnpm sheets:apply-ai-updates -- --run-dir <dir>
pnpm sheets:apply-intake -- --run-dir <dir>
pnpm sheets:check
pnpm sheets:export
pnpm sheets:init
pnpm sheets:migrate-headers
pnpm sheets:migrate-field-value -- --sheet photos --field recommended_uses --from <old-value> --to <new-value>
pnpm sheets:practice:build
pnpm sheets:practice:sync
pnpm sheets:report
pnpm sheets:sync-guide
pnpm sheets:sync-taxonomy
pnpm data:validate
git status --short
```

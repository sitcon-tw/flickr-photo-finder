# AGENTS.md

## Project Context

This repository is for building a SITCON Flickr photo finder: a lightweight photo index and future search workflow for helping SITCON organizers find usable public event photos.

The main goal is not to replace Flickr. The repository should keep a practical index layer on top of Flickr so organizers can search by real work needs such as social promotion, website visuals, sponsor proposals, sponsor fulfillment evidence, press materials, recap posts, and design assets.

## Current Artifacts

- `docs/photo-finder-mvp.md`: product notes, MVP rationale, and field decisions.
- `docs/mvp-implementation-plan.md`: executable MVP plan, field types, taxonomy, curation workflow, and validation criteria.
- `docs/data-entry-guide.md`: data entry rules for the first curated photo index.
- `docs/database-collaboration-strategy.md`: Sheets-first database and volunteer collaboration strategy.
- `docs/agent-maintenance-guide.md`: maintenance guide for future agents and technical volunteers.
- `docs/project-architecture.md`: end-to-end usage flow, data flow, and deployment architecture.
- `docs/google-sheets-database-design.md`: formal Google Sheets database table design.
- `docs/sheets-sync-workflow.md`: workflow for syncing Google Sheets with repo tools.
- `docs/ai-readable-dataset.md`: guidance for public AI and read-only tools consuming the dataset.
- `docs/apps-script-maintenance-design.md`: Apps Script maintenance helper design.
- `docs/README.md`: documentation index, implementation status, and source-of-truth map.
- `docs/photo-fields-reference.md`: field reference for the Google Sheets photo table and CSV export format.
- `docs/public-frontend-architecture.md`: GitHub Pages public read-only frontend architecture.
- `README.md`: human-facing project overview and quick start.
- `app/`: GitHub Pages and local static search UI for the MVP.
- `app/config.js`: public frontend data source configuration.
- `config/project.json`: project-level organization, Flickr account, and frontend display configuration.
- `fixtures/albums.csv`: MVP sample, local fixture, and Sheets export format reference for the SITCON Flickr album catalog. It is not the authoritative album database or a Sheets cache.
- `fixtures/photos.csv`: MVP sample, local fixture, and Sheets export format reference. It is not the authoritative photo database or a Sheets cache.
- `fixtures/import-batches.csv`: MVP sample, local fixture, and Sheets export format reference for import batch records. It is not the authoritative import batch database or a Sheets cache.
- `data/photo-schema.json`: shared field schema for Google Sheets, CSV exports, Apps Script helpers, and CLI validation.
- `data/tag-taxonomy.json`: controlled taxonomy for photo tags and enum fields.
- `data/sponsorship-items.json`: fixed snapshot derived from SITCON 2026 CFS sponsorship item data.
- `scripts/add-photo.mjs`: helper for generating or appending a CSV row from a Flickr photo URL.
- `scripts/discover-albums.mjs`: helper for discovering SITCON Flickr albums and writing the local album fixture.
- `scripts/list-albums.mjs`: helper for listing and filtering exported Google Sheets albums before choosing an intake target.
- `scripts/sync-albums.mjs`: helper for merging a Google Sheets albums CSV export with discovered albums and producing a Sheets-ready CSV.
- `scripts/run-intake.mjs`: helper for producing a complete intake run artifact from a selected album.
- `scripts/validate-intake-run.mjs`: helper for checking an intake run artifact before applying it to Google Sheets.
- `scripts/apply-intake-run.mjs`: SDK-based helper for applying a reviewed intake run artifact to Google Sheets.
- `scripts/prepare-ai-run.mjs`: helper for creating a local AI labeling input run from exported Google Sheets photos.
- `scripts/import-album-photos.mjs`: helper for generating Sheets-ready candidate photo rows, updated album rows, and import batch rows from a selected album.
- `scripts/flickr-album-photos.mjs`: shared Flickr album photo URL extraction helper.
- `scripts/add-album.mjs`: low-level helper for checking or importing missing photos from a discovered album ID or Flickr album URL.
- `scripts/check-sheets.mjs`: read-only helper for checking public Google Sheets fixed tabs and initialization overwrite risk.
- `scripts/apply-sheets-init.mjs`: SDK-based helper for applying `sheets:init` CSVs to Google Sheets after an authenticated dry-run.
- `scripts/init-sheets.mjs`: helper for generating Google Sheets MVP initialization CSVs.
- `scripts/export-sheets.mjs`: SDK-based helper for exporting fixed Google Sheets tabs to local CSV files for validation and intake workflows.
- `scripts/serve.mjs`: local static server for the MVP UI.
- `scripts/validate-data.mjs`: data validation script.

## Data Principles

- Google Sheets is the authoritative photo index database. If Google Sheets and repo sample data disagree, Google Sheets wins.
- This repo is the governance and tooling layer: schema, taxonomy, validation, import/export scripts, Apps Script source or generators, AI prompts, and maintenance documentation.
- Keep reusable organization-specific values in `config/project.json` when practical. SITCON is the default instance, but the project should remain forkable by other organizations.
- `config/project.json` may include the public Google Sheets `spreadsheetId`. This is not treated as a secret for this project; write access is managed by Google Drive/Sheets permissions.
- Google Sheets tab names are fixed for the MVP: `photos`, `albums`, `import_batches`, `taxonomy`, and `sponsorship_items`.
- Use the official Google Sheets API SDK as the primary direction for repo CLI operations that read or write Sheets tabs, ranges, appends, batch updates, and read-back verification.
- Do not build Google Drive file transfer flows for Sheets table semantics.
- Do not assume the current user's local authorization method, such as OAuth token caches, browser sessions, gcloud accounts, clasp login, or third-party tool sessions, will be available to other users.
- Document required capabilities, OAuth scopes, credential expectations, dry-run behavior, and verification steps separately from local credential setup.
- Treat `data/photo-schema.json` as the machine-readable source for photo, album, and import batch field order, basic field metadata, reviewed completeness rules, and approved-use requirements.
- Do not duplicate reviewed/approved field lists in docs. Reference `data/photo-schema.json` instead.
- Do not treat `fixtures/photos.csv` as production data. It exists for MVP demos, local UI development, validation fixtures, and future export-format tests.
- Do not treat `fixtures/albums.csv` as production data. It exists for MVP demos, debugging, validation fixtures, and future export-format tests.
- Treat `tmp/sheets-export/*.csv` as local work cache exported from the formal Google Sheets database. Do not commit it.
- The public GitHub Pages frontend is read-only. It should read Google Sheets public output data and must not contain secrets or database-write credentials.
- `photos` is the public photo index. Public CSV/JSON exports are transport formats with the same fields, not an additional filtered table.
- Album intake should start from the SITCON Flickr album catalog discovered by tools. Users should choose which discovered album to process instead of manually supplying album URLs as the primary workflow.
- GitHub Pages should be deployed through a GitHub Actions artifact, not by publishing the whole repository root.
- Apps Script should be deployed through `clasp`. Keep Apps Script source in the repo, but do not commit personal clasp credentials, Google API credentials, or tokens.
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
- For database shape, read `docs/google-sheets-database-design.md` before changing Sheets or sync assumptions.
- For public AI behavior, read `docs/ai-readable-dataset.md` before changing photo index read semantics.
- For Apps Script helpers, read `docs/apps-script-maintenance-design.md` before adding Sheets-side validation.
- Help maintain the repo so future agents can understand how to scan albums, validate data, assist AI labeling, and sync with Google Sheets.
- Do not store Google Drive, Google API, OAuth token, third-party tool, or AI API credentials in this repo.
- For organization-level access and handoff, rely on SITCON's existing documentation and Google Drive management practices rather than inventing repo-local credential rules.
- AI-generated labels may be written only as human-reviewable candidates. Keep `curation_status` semantics clear: `ai_labeled` is not the same as `reviewed`.

## Validation

Run data validation after changing local sample/export data, `data/photo-schema.json`, taxonomy files, or validation logic:

```bash
pnpm validate:data
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
pnpm dev
pnpm albums:discover
pnpm albums:list
pnpm albums:select
pnpm albums:sync -- --sheets-export <albums-csv> --output <albums-csv>
pnpm ai:prepare
pnpm intake:run -- --album <album-id>
pnpm intake:validate -- --run-dir <dir>
pnpm photos:import -- --album <album-id> --output <photos-csv> --albums-output <albums-csv> --batch-output <batch-csv>
pnpm album:add -- <flickr-album-url>
pnpm album:add -- <album-id>
pnpm photo:add -- <flickr-photo-url>
pnpm sheets:apply-init
pnpm sheets:apply-intake -- --run-dir <dir>
pnpm sheets:check
pnpm sheets:export
pnpm sheets:init
pnpm sheets:migrate-headers
pnpm validate:data
git status --short
```

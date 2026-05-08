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
- `docs/photo-fields-reference.md`: field reference for the Google Sheets photo table and CSV export format.
- `README.md`: human-facing project overview and quick start.
- `app/`: local static search UI for the MVP.
- `data/photos.csv`: MVP sample, local fixture, and Sheets export format reference. It is not the authoritative photo database.
- `data/tag-taxonomy.json`: controlled taxonomy for photo tags and enum fields.
- `data/sponsorship-items.json`: fixed snapshot derived from SITCON 2026 CFS sponsorship item data.
- `scripts/add-photo.mjs`: helper for generating or appending a CSV row from a Flickr photo URL.
- `scripts/add-album.mjs`: helper for checking or importing missing photos from a Flickr album URL.
- `scripts/serve.mjs`: local static server for the MVP UI.
- `scripts/validate-data.mjs`: data validation script.

## Data Principles

- Google Sheets is the authoritative photo index database. If Google Sheets and repo sample data disagree, Google Sheets wins.
- This repo is the governance and tooling layer: schema, taxonomy, validation, import/export scripts, Apps Script source or generators, AI prompts, and maintenance documentation.
- Do not treat `data/photos.csv` as production data. It exists for MVP demos, local UI development, validation fixtures, and future export-format tests.
- Treat `data/sponsorship-items.json` as a fixed snapshot. SITCON 2026 CFS has ended, so do not build auto-sync behavior for that data.
- Future CFS versions should be introduced explicitly as new or replacement versioned data, not by assuming the 2026 snapshot keeps changing.
- `sponsorship_items` should align with CFS item names. Do not invent a parallel sponsorship item vocabulary unless the documents explain why.
- SITCON is the owner of the SITCON Flickr account, but photographer credit is listed in the Flickr title when available. Do not treat Flickr oEmbed `author_name` as the photographer.
- Keep `scene_tags`, `sponsorship_items`, and `sponsorship_tags` conceptually separate:
  - `scene_tags`: visual facts in the photo.
  - `sponsorship_items`: sponsor inventory item.
  - `sponsorship_tags`: sponsor value or proof use.
- CSV multi-value fields use semicolon-separated values, for example `攤位;會眾`.
- `internal_notes` is public in the Sheets-first architecture despite its name. Do not put sensitive internal information there.

## Agent Responsibilities

- Read `docs/agent-maintenance-guide.md` before making data workflow or AI-assist changes.
- Help maintain the repo so future agents can understand how to scan albums, validate data, assist AI labeling, and sync with Google Sheets.
- Do not store Google Drive, rclone, Google API, or AI API credentials in this repo.
- For organization-level access and handoff, rely on SITCON's existing documentation and Google Drive management practices rather than inventing repo-local credential rules.
- AI-generated labels may be written only as human-reviewable candidates. Keep `curation_status` semantics clear: `ai_labeled` is not the same as `reviewed`.

## Validation

Run data validation after changing local sample/export data under `data/` or changing validation logic:

```bash
npm run validate:data
```

The validation script currently checks:

- `data/photos.csv` headers for the local sample/export format.
- Required photo fields.
- URL format.
- controlled taxonomy values.
- duplicate list values.
- `quality_score` range.
- taxonomy consistency with `data/sponsorship-items.json`.

## Editing Guidance

- Keep documentation in Traditional Chinese unless there is a reason to write technical metadata in English.
- Prefer small, reviewable commits around coherent decisions or implementation slices.
- When a meaningful section is completed, suggest a commit point to the user.
- Do not add dependencies unless the benefit is concrete and documented.
- For data changes, prefer updating the source data and validation rules together when a new invariant appears.

## Useful Commands

```bash
npm run dev
npm run album:add -- <flickr-album-url>
npm run photo:add -- <flickr-photo-url>
npm run validate:data
git status --short
```

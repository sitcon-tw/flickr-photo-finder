# AGENTS.md

## Project Context

This repository is for building a SITCON Flickr photo finder: a lightweight photo index and future search workflow for helping SITCON organizers find usable public event photos.

The main goal is not to replace Flickr. The repository should keep a practical index layer on top of Flickr so organizers can search by real work needs such as social promotion, website visuals, sponsor proposals, sponsor fulfillment evidence, press materials, recap posts, and design assets.

## Current Artifacts

- `docs/photo-finder-mvp.md`: product notes, MVP rationale, and field decisions.
- `docs/mvp-implementation-plan.md`: executable MVP plan, field types, taxonomy, curation workflow, and validation criteria.
- `data/photos.csv`: photo index template.
- `data/tag-taxonomy.json`: controlled taxonomy for photo tags and enum fields.
- `data/sponsorship-items.json`: fixed snapshot derived from SITCON 2026 CFS sponsorship item data.
- `scripts/validate-data.mjs`: data validation script.

## Data Principles

- Treat `data/sponsorship-items.json` as a fixed snapshot. SITCON 2026 CFS has ended, so do not build auto-sync behavior for that data.
- Future CFS versions should be introduced explicitly as new or replacement versioned data, not by assuming the 2026 snapshot keeps changing.
- `sponsorship_items` should align with CFS item names. Do not invent a parallel sponsorship item vocabulary unless the documents explain why.
- Keep `scene_tags`, `sponsorship_items`, and `sponsorship_tags` conceptually separate:
  - `scene_tags`: visual facts in the photo.
  - `sponsorship_items`: sponsor inventory item.
  - `sponsorship_tags`: sponsor value or proof use.
- CSV multi-value fields use semicolon-separated values, for example `攤位;會眾`.

## Validation

Run data validation after changing anything under `data/` or changing validation logic:

```bash
npm run validate:data
```

The validation script currently checks:

- `data/photos.csv` headers.
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
npm run validate:data
git status --short
```

---
name: releasy-release
description: >-
  Create the Azure DevOps release-container Feature and its 6 standard child Tasks for a named
  patch (e.g. Labe-07.014), matching the Labe-07.013 template: title `Release: <Version>
  (<DD/MM/YYYY>)` with no product prefix, Tasks numbered 01-06 with no DEV/TEST prefix. Use when
  the user asks to create a release ticket, release container, release tasks, or a
  `Release: Labe-…` / `Release: Schneeberg-…` work item for a patch.
---

# releasy-release

Creates the **release container** Feature + the 6 checklist Tasks that every patch uses to
actually ship. Task titles match Labe-07.013 (Feature #10076 / Tasks #10077-#10082) and are
identical on XeeloAdmin and Integray. Product-specific extras (e.g. Integray 017's `07 …`) are
**not** part of this template — ignore them unless the user explicitly asks to add one.

This is **not** a normal Bug/Feature. `create-ticket.mjs` / `create-task.mjs` require a product /
DEV prefix and would reject this shape. The write script is
[`../releasy-ai/scripts/create-release.mjs`](../releasy-ai/scripts/create-release.mjs); same PAT
as releasy-ai (`.cursor/skills/releasy-ai/.env`).

**Never skip the confirmation step.** Print the plan and wait before running the script without
`--dry-run`.

## 0. Always start here

Run `node ../releasy-ai/scripts/releasy-config.mjs` (from this folder) for live products,
`releaseNames`, `availablePatchVersions`, and `assignees`. Never hardcode series/patches.

If the user already named a ticket, `node ../releasy-ai/scripts/get-ticket.mjs <id>` first.

## 1. Resolve the patch and the date

1. Product + version: `Labe-07.014` → product Xeelo (via `releaseNames`), release `Labe`, major
   `07`, patch `014`. If a product has more than one active series, ask — never guess.
2. Patch must be a **scheduled** patch in `availablePatchVersions`, not backlog `999`.
3. Date goes in the title as `DD/MM/YYYY`. If the user said "25 August 2026" / `25.8.2026` /
   ISO, convert. If they did not give a date, **ask**.
4. Check the patch does not already have a container: list Features in that patch (`list-tickets.mjs
   --product … --major … --patch … --no-tasks`) and look for a title starting `Release: <Version>`.
   The script also refuses a duplicate.

## 2. Assignees

| Role | Default |
|---|---|
| Parent Feature | `tomas.kocyan@intelstudios.com` (Tomáš Kocyan) |
| Tasks 01-05 | `tomas.kocyan@intelstudios.com` (Tomáš Kocyan) |
| Task 06 (set production) | `tomas@intelstudios.com` (Tomas Belak) |

Keep these unless the user overrides. Validate every email against live `assignees`.

## 3. What gets created

Feature, Priority **4**, no t-shirt, no description, Tags = product, PlatformRelease =
`<Release>-<major>.<patch>`, parent Epic from `releaseNames`:

```
Release: Labe-07.014 (25/08/2026)
```

No `Xeelo -` prefix. Tasks — **verbatim**, including the periods on 01./02./03. and the missing
periods on 04/05/06; no `DEV -` / `TEST -`:

1. `01. Preparation of the release branch`
2. `02. Verification that the release branch is rebased onto its predecessor`
3. `03. Locking of the release branch to prevent changes`
4. `04 Verification that the release branch can be deployed via provisioning`
5. `05 Verification that all tasks are closed (formality check)`
6. `06 Set the release branch as production on provisioning`

Each Task also gets `Custom.PlatformRelease` (that is how 013 stored them). They do **not** get
Tags, Priority, or a description.

Do not add extra tickets to the patch as part of this skill. Do not change 01-06 wording.

## 4. Confirm, then create

Print: product, version, title, date, parent assignee, each task title + assignee. Stop.

On confirmation, from `.cursor/skills/releasy-ai`:

```
node scripts/create-release.mjs --version Labe-07.014 --date 25/08/2026
```

Overrides: `--owner`, `--steps-assignee`, `--production-assignee` (emails). Sanity-check without
writing: add `--dry-run`.

Report the Feature id, the six Task ids, and their Releasy URLs.

## Related

- Ticket CRUD / lists: [releasy-ai](../releasy-ai/SKILL.md)
- Business-facing `.docx` notes (reads this container for the date): [releasy-notes](../releasy-notes/SKILL.md)

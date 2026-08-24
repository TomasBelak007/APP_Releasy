#!/usr/bin/env node
// Creates the release-container Feature + its 6 standard child Tasks, matching the Labe-07.013
// template (Feature #10076). This is NOT a normal Bug/Feature: the title has no product prefix
// (`Release: Labe-07.014 (25/08/2026)`), the Tasks have no DEV/TEST prefix, and there is no
// description / t-shirt. create-ticket.mjs / create-task.mjs reject that shape - use this
// script instead. Workflow (confirm first) lives in the sibling releasy-release skill.
//
// Usage:
//   node create-release.mjs --version Labe-07.014 --date 25/08/2026
//   node create-release.mjs --version Labe-07.014 --date 25/08/2026 --dry-run
//   node create-release.mjs --product Xeelo --release Labe --major 07 --patch 014 --date 25/08/2026
//
// Optional assignees (owner + 01-05 = Tomáš Kocyan; 06 = Tomas Belak):
//   --owner email              parent Feature (default tomas.kocyan@intelstudios.com)
//   --steps-assignee email     tasks 01-05    (default tomas.kocyan@intelstudios.com)
//   --production-assignee email task 06       (default tomas@intelstudios.com)

import {
  loadReleasyConfig,
  findEpicId,
  isValidPatch,
  isValidAssignee,
  parseReleaseVersion
} from './releasy-config.mjs';
import {
  loadPat,
  createWorkItemApi,
  runWiql,
  escapeWiqlString,
  releasyWorkItemUrl,
  parseArgs,
  fail
} from './lib.mjs';

// Exact titles from Labe-07.013 (#10077-#10082), including the 01./02./03. periods and the
// missing periods on 04/05/06. Do not "fix" them - later patches (Integray 017 included) copy
// this wording verbatim.
const RELEASE_STEPS = [
  { title: '01. Preparation of the release branch', role: 'steps' },
  { title: '02. Verification that the release branch is rebased onto its predecessor', role: 'steps' },
  { title: '03. Locking of the release branch to prevent changes', role: 'steps' },
  { title: '04 Verification that the release branch can be deployed via provisioning', role: 'steps' },
  { title: '05 Verification that all tasks are closed (formality check)', role: 'steps' },
  { title: '06 Set the release branch as production on provisioning', role: 'production' }
];

const DEFAULT_OWNER = 'tomas.kocyan@intelstudios.com';
const DEFAULT_STEPS = 'tomas.kocyan@intelstudios.com';
const DEFAULT_PRODUCTION = 'tomas@intelstudios.com';

function pad(value, length) {
  return String(value).trim().padStart(length, '0');
}

function parseDate(raw) {
  const str = String(raw || '').trim();
  let d;
  let m;
  let y;
  const slash = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dot = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (slash) {
    d = parseInt(slash[1], 10); m = parseInt(slash[2], 10); y = parseInt(slash[3], 10);
  } else if (iso) {
    y = parseInt(iso[1], 10); m = parseInt(iso[2], 10); d = parseInt(iso[3], 10);
  } else if (dot) {
    d = parseInt(dot[1], 10); m = parseInt(dot[2], 10); y = parseInt(dot[3], 10);
  } else {
    fail(`--date must be DD/MM/YYYY (or YYYY-MM-DD). Got "${raw}".`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    fail(`--date "${raw}" is not a real calendar date.`);
  }
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function resolveVersion(cfg, flags) {
  let release;
  let major;
  let patch;
  if (flags.version) {
    const parsed = parseReleaseVersion(flags.version);
    if (!parsed) fail(`--version must look like Labe-07.014 (got "${flags.version}").`);
    release = parsed.name;
    major = parsed.major;
    patch = parsed.patch;
  } else if (flags.release && flags.major && flags.patch) {
    release = String(flags.release).trim();
    major = pad(flags.major, 2);
    patch = pad(flags.patch, 3);
  } else {
    fail('Pass --version Labe-07.014, or --release + --major + --patch.');
  }

  let product = flags.product ? String(flags.product).trim() : null;
  if (!product) {
    const byRelease = cfg.releaseNames.find((r) => r.release === release);
    if (!byRelease) {
      fail(`Release "${release}" is not in releaseNames. Pass --product explicitly. Known: ${cfg.releaseNames.map((r) => `${r.product} (${r.release})`).join(', ')}.`);
    }
    product = byRelease.product;
  } else if (!cfg.titlePrefixes[product]) {
    fail(`Unknown product "${product}". Known: ${Object.keys(cfg.titlePrefixes).join(', ')}.`);
  }

  if (!findEpicId(cfg, release)) {
    fail(`Release "${release}" has no epicID in releaseNames.`);
  }
  if (patch === '999') {
    fail('A release container is for a scheduled patch, not the backlog (999).');
  }
  if (!isValidPatch(cfg, product, release, major, patch)) {
    fail(`"${release}-${major}.${patch}" is not a currently available patch for "${product}".`);
  }

  return { product, release, major, patch, platformRelease: `${release}-${major}.${patch}` };
}

async function findExistingContainer(cfg, platformRelease, pat) {
  const titlePrefix = `Release: ${platformRelease}`;
  const query = `SELECT [System.Id] FROM workitems
    WHERE [System.TeamProject] = 'Board'
      AND [System.WorkItemType] = 'Feature'
      AND [Custom.PlatformRelease] = '${escapeWiqlString(platformRelease)}'
      AND [System.Title] CONTAINS '${escapeWiqlString(titlePrefix)}'
    ORDER BY [System.Id] ASC`;
  const result = await runWiql(cfg, query, pat);
  return (result.workItems || []).map((w) => w.id);
}

function buildFeatureOperations(cfg, { product, release, platformRelease, title, ownerEmail }) {
  const epicID = findEpicId(cfg, release);
  return [
    { op: 'add', path: '/fields/System.Title', value: title },
    { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 4 },
    { op: 'add', path: '/fields/System.Tags', value: product },
    { op: 'add', path: '/fields/Custom.PlatformRelease', value: platformRelease },
    { op: 'add', path: '/fields/System.AssignedTo', value: ownerEmail },
    {
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: `https://dev.azure.com/${cfg.organization}/${cfg.project}/_apis/wit/workitems/${epicID}`
      }
    }
  ];
}

function buildTaskOperations(cfg, { title, assigneeEmail, platformRelease, parentId }) {
  // PlatformRelease is copied onto the Task because that is how Labe-07.013 was stored
  // (#10077-#10082). Regular create-task.mjs Tasks do not get this field.
  return [
    { op: 'add', path: '/fields/System.Title', value: title },
    { op: 'add', path: '/fields/Custom.PlatformRelease', value: platformRelease },
    { op: 'add', path: '/fields/System.AssignedTo', value: assigneeEmail },
    {
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: `https://dev.azure.com/${cfg.organization}/${cfg.project}/_apis/wit/workitems/${parentId}`
      }
    }
  ];
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (!flags.date) fail('Usage: node create-release.mjs --version Labe-07.014 --date 25/08/2026 [--dry-run]');

  const cfg = loadReleasyConfig();
  const version = resolveVersion(cfg, flags);
  const date = parseDate(flags.date);
  const title = `Release: ${version.platformRelease} (${date})`;

  const ownerEmail = flags.owner || DEFAULT_OWNER;
  const stepsEmail = flags['steps-assignee'] || DEFAULT_STEPS;
  const productionEmail = flags['production-assignee'] || DEFAULT_PRODUCTION;

  for (const [label, email] of [
    ['--owner', ownerEmail],
    ['--steps-assignee', stepsEmail],
    ['--production-assignee', productionEmail]
  ]) {
    if (!isValidAssignee(cfg, email)) {
      fail(`${label} "${email}" is not in the known assignees list.`);
    }
  }

  const steps = RELEASE_STEPS.map((step) => ({
    title: step.title,
    assigneeEmail: step.role === 'production' ? productionEmail : stepsEmail
  }));

  const pat = loadPat();
  const existing = await findExistingContainer(cfg, version.platformRelease, pat);
  if (existing.length) {
    fail(
      `A release container already exists for ${version.platformRelease}: ` +
      existing.map((id) => `#${id} ${releasyWorkItemUrl(id)}`).join(', ')
    );
  }

  if (flags['dry-run']) {
    console.log(JSON.stringify({
      dryRun: true,
      product: version.product,
      platformRelease: version.platformRelease,
      title,
      priority: 4,
      ownerEmail,
      tasks: steps
    }, null, 2));
    return;
  }

  const created = await createWorkItemApi(
    cfg,
    'Feature',
    buildFeatureOperations(cfg, { ...version, title, ownerEmail }),
    pat
  );

  const tasks = [];
  for (const step of steps) {
    const createdTask = await createWorkItemApi(
      cfg,
      'Task',
      buildTaskOperations(cfg, {
        title: step.title,
        assigneeEmail: step.assigneeEmail,
        platformRelease: version.platformRelease,
        parentId: created.id
      }),
      pat
    );
    tasks.push({
      id: createdTask.id,
      title: createdTask.fields['System.Title'],
      url: releasyWorkItemUrl(createdTask.id)
    });
  }

  console.log(`Feature #${created.id} "${created.fields['System.Title']}" - ${releasyWorkItemUrl(created.id)}`);
  for (const t of tasks) {
    console.log(`  Task #${t.id} "${t.title}" - ${t.url}`);
  }
}

main().catch((e) => fail(e.message));

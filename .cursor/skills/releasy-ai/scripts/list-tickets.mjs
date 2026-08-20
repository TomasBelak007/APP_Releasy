#!/usr/bin/env node
// Lists Bugs/Features (+ their Tasks, with details) for one product, scoped to a specific
// release/major/patch or the whole backlog (patch "999") - the read side of "what's queued up
// for the backlog" or "what's not done yet in this release" questions. Read-only (WIQL + batch
// GET), so - unlike get-ticket.mjs which already existed for a single item - the agent can pull
// the raw list here and reason over states/priorities/tasks itself; this script does not filter
// by "done"/"not done" on your behalf.
//
// Usage:
//   node list-tickets.mjs --product Xeelo                        # everything under Xeelo's release
//   node list-tickets.mjs --product Xeelo --major 07              # everything under Labe-07.*
//   node list-tickets.mjs --product Xeelo --major 07 --patch 015  # exactly Labe-07.015
//   node list-tickets.mjs --product Xeelo --backlog               # the backlog (major auto-resolved if unique)
//   node list-tickets.mjs --product Xeelo --backlog --open        # backlog, excluding Closed/Removed
//   node list-tickets.mjs --product Xeelo --state New,Active      # only these states
//   node list-tickets.mjs --product Xeelo --no-tasks               # skip the child-task fetch (faster)
//   node list-tickets.mjs --product Xeelo --patch 013 --descriptions --no-tasks

import { loadReleasyConfig, isValidStatus, findMajorsForRelease } from './releasy-config.mjs';
import {
  loadPat,
  runWiql,
  getWorkItemsBatch,
  fetchChildTasks,
  escapeWiqlString,
  releasyWorkItemUrl,
  parseArgs,
  printJson,
  fail
} from './lib.mjs';

/** --major/--patch come in as "7"/"15" as easily as "07"/"015" - normalize to what
 * Custom.PlatformRelease and availablePatchVersions actually store. */
function pad(value, length) {
  return String(value).trim().padStart(length, '0');
}

/** Resolves `major` when the caller only gave --backlog/--patch: if the product has exactly one
 * configured major under this release, use it; otherwise fail and list the real options rather
 * than guess. */
function resolveMajor(cfg, product, release, explicitMajor) {
  if (explicitMajor) return pad(explicitMajor, 2);
  const majors = findMajorsForRelease(cfg, product, release);
  if (majors.length === 1) return majors[0];
  if (majors.length === 0) {
    fail(`No configured major version for "${product}" under release "${release}" - pass --major explicitly.`);
  }
  fail(`Product "${product}" has ${majors.length} active majors under "${release}" (${majors.join(', ')}) - pass --major to pick one.`);
}

function taskSummary(task) {
  const f = task.fields || {};
  return {
    id: task.id,
    title: f['System.Title'] || '',
    state: f['System.State'] || '',
    assignedTo: f['System.AssignedTo']?.displayName || f['System.AssignedTo']?.uniqueName || null,
    description: f['System.Description'] || '',
    url: releasyWorkItemUrl(task.id)
  };
}

/** Same field pick as get-ticket.mjs: Bug uses ReproSteps when present, otherwise Description. */
function itemDescription(type, fields) {
  const descriptionFieldPath = type === 'Bug' && fields['Microsoft.VSTS.TCM.ReproSteps']
    ? 'Microsoft.VSTS.TCM.ReproSteps'
    : 'System.Description';
  return fields[descriptionFieldPath] || '';
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const cfg = loadReleasyConfig();

  const product = flags.product;
  if (!product) {
    fail(`Missing --product. Valid products: ${cfg.releaseNames.map((r) => r.product).join(', ')}.`);
  }
  const releaseConfig = cfg.releaseNames.find((r) => r.product === product);
  if (!releaseConfig) {
    fail(`Unknown product "${product}". Valid products: ${cfg.releaseNames.map((r) => r.product).join(', ')}.`);
  }

  const release = flags.release ? String(flags.release).trim() : releaseConfig.release;

  if (flags.backlog && flags.patch && pad(flags.patch, 3) !== '999') {
    fail('--backlog and --patch are mutually exclusive (backlog is always patch "999").');
  }
  const wantsPatch = flags.backlog ? true : flags.patch !== undefined;
  const patch = wantsPatch ? (flags.backlog ? '999' : pad(flags.patch, 3)) : null;
  const major = (flags.major !== undefined || wantsPatch)
    ? resolveMajor(cfg, product, release, flags.major)
    : null;

  let releaseFilter;
  if (major && patch) {
    releaseFilter = `[Custom.PlatformRelease] = '${escapeWiqlString(`${release}-${major}.${patch}`)}'`;
  } else if (major) {
    releaseFilter = `[Custom.PlatformRelease] CONTAINS '${escapeWiqlString(`${release}-${major}.`)}'`;
  } else {
    releaseFilter = `[Custom.PlatformRelease] CONTAINS '${escapeWiqlString(`${release}-`)}'`;
  }

  let stateFilter = '';
  if (flags.state) {
    const states = String(flags.state).split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of states) {
      if (!isValidStatus(cfg, 'Bug', s)) {
        fail(`Invalid --state "${s}". Valid: ${cfg.statusOptions.Bug.join(', ')}.`);
      }
    }
    stateFilter = ` AND [System.State] IN (${states.map((s) => `'${escapeWiqlString(s)}'`).join(', ')})`;
  } else if (flags.open) {
    stateFilter = ` AND [System.State] NOT IN ('Closed', 'Removed')`;
  }

  const query = `SELECT [System.Id] FROM workitems
    WHERE [System.TeamProject] = 'Board'
      AND [System.WorkItemType] IN ('Feature', 'Bug')
      AND ${releaseFilter}${stateFilter}
    ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.Id] ASC`;

  const pat = loadPat();
  const wiqlResult = await runWiql(cfg, query, pat);
  const ids = (wiqlResult.workItems || []).map((w) => w.id);

  const includeTasks = !flags['no-tasks'];
  const includeDescriptions = !!flags.descriptions;
  let items = [];
  if (ids.length) {
    const fullItems = await getWorkItemsBatch(cfg, ids, pat, { expandRelations: includeTasks });
    items = await Promise.all(fullItems.map(async (item) => {
      const f = item.fields || {};
      const type = f['System.WorkItemType'];
      const base = {
        id: item.id,
        type,
        title: f['System.Title'] || '',
        state: f['System.State'] || '',
        priority: f['Microsoft.VSTS.Common.Priority'] ?? null,
        severity: f['Microsoft.VSTS.Common.Severity'] || null,
        tshirtSize: f['Custom.Shirtsize'] || null,
        platformRelease: f['Custom.PlatformRelease'] || null,
        assignedTo: f['System.AssignedTo']?.displayName || f['System.AssignedTo']?.uniqueName || null,
        createdDate: f['System.CreatedDate'] || null,
        changedDate: f['System.ChangedDate'] || null,
        url: releasyWorkItemUrl(item.id)
      };
      if (includeDescriptions) {
        base.description = itemDescription(type, f);
      }
      if (includeTasks) {
        base.tasks = (await fetchChildTasks(cfg, item.id, item.relations, pat)).map(taskSummary);
      }
      return base;
    }));
    items.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id - b.id);
  }

  printJson({
    product,
    release,
    major,
    patch,
    scope: major && patch ? `${release}-${major}.${patch}` : major ? `${release}-${major}.*` : `${release}-*`,
    count: items.length,
    items
  });
}

main().catch((e) => fail(e.message));

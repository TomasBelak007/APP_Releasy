#!/usr/bin/env node
// Edits fields on an existing Bug, Feature, or Task - a subset of what create-ticket.mjs sets on
// creation, reusing the same per-type rules (no severity on a Feature, no priority/severity/
// tshirt/release on a Task, etc) and the same live-config validation.
//
// Usage:
//   node update-ticket.mjs <id-or-url> [--title "..."] [--priority 1-4] [--severity "2 - High"]
//                           [--tshirt S|M|L] [--release Labe --major 07 --patch 999]
//                           [--assignee email] [--unassign]
//                           [--description "..." | --description-file path]
//
// Only the flags you pass are changed; everything else on the item is left untouched. Note:
// description edits are written in whatever format (Html/Markdown) the field already has - no
// Html<->Markdown conversion here (that, including screenshot blob-URL handling, is a
// browser-only Releasy-UI feature, see reference.md).

import {
  loadReleasyConfig,
  isValidPriority,
  resolveSeverityLabel,
  isValidTshirtSize,
  isValidPatch,
  isValidAssignee,
  resolveProduct
} from './releasy-config.mjs';
import { loadPat, getWorkItem, patchWorkItem, releasyWorkItemUrl, parseWorkItemId, parseArgs, readTextFlag, fail } from './lib.mjs';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (!positional[0]) fail('Usage: node update-ticket.mjs <id-or-url> [--title ...] [--priority ...] [--severity ...] [--tshirt ...] [--release ... --major ... --patch ...] [--assignee ...] [--unassign] [--description ... | --description-file ...]');

  const id = parseWorkItemId(positional[0]);
  const cfg = loadReleasyConfig();
  const pat = loadPat();

  const current = await getWorkItem(cfg, id, pat);
  const fields = current.fields || {};
  const type = fields['System.WorkItemType'];
  if (!type) fail(`Work item #${id} was not found in ${cfg.organization}/${cfg.project}.`);
  // Not fields['System.Tags'] directly - Azure DevOps lower-cases Tags on save, which would break
  // the exact-case availablePatchVersions lookup below. See resolveProduct()'s own comment.
  const product = resolveProduct(cfg, fields);

  const description = readTextFlag(flags, 'description', 'description-file');
  const errors = [];
  const operations = [];
  const summary = [];

  if (typeof flags.title === 'string') {
    operations.push({ op: 'replace', path: '/fields/System.Title', value: flags.title.trim() });
    summary.push(`title -> "${flags.title.trim()}"`);
  }

  if (flags.priority !== undefined) {
    if (type === 'Task') {
      errors.push('--priority is not valid on a Task (Tasks have no Priority field).');
    } else if (!isValidPriority(flags.priority)) {
      errors.push(`--priority must be one of 1-4 (got "${flags.priority}").`);
    } else {
      operations.push({ op: 'replace', path: '/fields/Microsoft.VSTS.Common.Priority', value: parseInt(flags.priority, 10) });
      summary.push(`priority -> ${flags.priority}`);
    }
  }

  if (flags.severity !== undefined) {
    if (type !== 'Bug') {
      errors.push('--severity is only valid on a Bug.');
    } else {
      const label = resolveSeverityLabel(cfg, flags.severity);
      if (!label) {
        errors.push(`--severity "${flags.severity}" is not a recognized rating (expected one of ${cfg.ratingLevels.map((l) => l.label).join(', ')}).`);
      } else {
        operations.push({ op: 'replace', path: '/fields/Microsoft.VSTS.Common.Severity', value: label });
        summary.push(`severity -> ${label}`);
      }
    }
  }

  if (flags.tshirt !== undefined) {
    if (type !== 'Feature') {
      errors.push('--tshirt is only valid on a Feature.');
    } else if (!isValidTshirtSize(flags.tshirt)) {
      errors.push(`--tshirt must be one of S, M, L (got "${flags.tshirt}").`);
    } else {
      operations.push({ op: 'replace', path: '/fields/Custom.Shirtsize', value: flags.tshirt });
      summary.push(`tshirtSize -> ${flags.tshirt}`);
    }
  }

  const releaseFlagsGiven = [flags.release, flags.major, flags.patch].filter((v) => v !== undefined).length;
  if (releaseFlagsGiven > 0) {
    if (type === 'Task') {
      errors.push('--release/--major/--patch are not valid on a Task (Tasks have no platform release).');
    } else if (releaseFlagsGiven < 3) {
      errors.push('--release, --major and --patch must all be given together to change the platform release.');
    } else if (!product) {
      errors.push(`Cannot validate a new patch version: could not resolve #${id}'s product from its current PlatformRelease/title.`);
    } else if (!isValidPatch(cfg, product, flags.release, flags.major, flags.patch)) {
      errors.push(`"${flags.release}-${flags.major}" patch "${flags.patch}" is not a currently available patch version for "${product}".`);
    } else {
      const platformRelease = `${flags.release}-${flags.major}.${flags.patch}`;
      operations.push({ op: 'replace', path: '/fields/Custom.PlatformRelease', value: platformRelease });
      summary.push(`platformRelease -> ${platformRelease}`);
    }
  }

  if (flags.unassign) {
    operations.push({ op: 'remove', path: '/fields/System.AssignedTo' });
    summary.push('assignedTo -> (unassigned)');
  } else if (flags.assignee !== undefined) {
    if (!isValidAssignee(cfg, flags.assignee)) {
      errors.push(`--assignee "${flags.assignee}" is not in the known assignees list.`);
    } else {
      operations.push({ op: 'replace', path: '/fields/System.AssignedTo', value: flags.assignee });
      summary.push(`assignedTo -> ${flags.assignee}`);
    }
  }

  if (description !== undefined) {
    const descriptionFieldPath = type === 'Bug' && fields['Microsoft.VSTS.TCM.ReproSteps'] !== undefined
      ? 'Microsoft.VSTS.TCM.ReproSteps'
      : 'System.Description';
    const currentFormat = String(current.multilineFieldsFormat?.[descriptionFieldPath] || '').toLowerCase();
    operations.push({ op: 'replace', path: `/fields/${descriptionFieldPath}`, value: description });
    // Re-assert the existing format alongside the content change, same as updateWorkItemDescription()
    // in index.html - insurance against Azure DevOps ever silently reverting it, never a conversion.
    if (currentFormat === 'markdown') {
      operations.push({ op: 'add', path: `/multilineFieldsFormat/${descriptionFieldPath}`, value: 'Markdown' });
    }
    summary.push(`description (${currentFormat === 'markdown' ? 'Markdown' : 'Html'}) updated`);
  }

  if (errors.length) {
    console.error(`Cannot update ${type} #${id} (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  if (!operations.length) fail('Nothing to update - pass at least one field flag.');

  await patchWorkItem(cfg, id, operations, pat);
  console.log(`${type} #${id} updated - ${releasyWorkItemUrl(id)}`);
  summary.forEach((s) => console.log(`  ${s}`));
}

main().catch((e) => fail(e.message));

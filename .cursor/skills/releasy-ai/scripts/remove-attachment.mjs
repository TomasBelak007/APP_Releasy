#!/usr/bin/env node
// Removes one AttachedFile relation from a Bug, Feature, or Task.
// The index is taken from the full relations array (not the filtered attachment list).
//
// Usage:
//   node remove-attachment.mjs <id-or-url> --name fileName

import { loadReleasyConfig } from './releasy-config.mjs';
import { loadPat, getWorkItem, patchWorkItem, releasyWorkItemUrl, parseWorkItemId, parseArgs, fail } from './lib.mjs';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (!positional[0] || !flags.name) {
    fail('Usage: node remove-attachment.mjs <id-or-url> --name fileName');
  }

  const id = parseWorkItemId(positional[0]);
  const cfg = loadReleasyConfig();
  const pat = loadPat();
  const name = String(flags.name);

  const data = await getWorkItem(cfg, id, pat, { expandRelations: true });
  const type = data.fields?.['System.WorkItemType'];
  if (!type) fail(`Work item #${id} was not found (or has no fields) in ${cfg.organization}/${cfg.project}.`);

  const relations = data.relations || [];
  const matches = [];
  relations.forEach((relation, index) => {
    if (relation.rel === 'AttachedFile' && relation.attributes?.name === name) {
      matches.push(index);
    }
  });

  if (matches.length === 0) {
    fail(`Work item #${id} has no attachment named "${name}".`);
  }
  if (matches.length > 1) {
    fail(`Work item #${id} has ${matches.length} attachments named "${name}". Remove is ambiguous.`);
  }

  await patchWorkItem(cfg, id, [{ op: 'remove', path: `/relations/${matches[0]}` }], pat);
  console.log(`Removed ${name} from ${type} #${id} - ${releasyWorkItemUrl(id)}`);
}

main().catch((e) => fail(e.message));

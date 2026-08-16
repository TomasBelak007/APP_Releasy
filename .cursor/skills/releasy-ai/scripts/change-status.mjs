#!/usr/bin/env node
// Changes System.State on an existing Bug, Feature, or Task. Looks the item's own type up first
// so it can validate the target state against the live statusOptions for that type before
// PATCHing - works the same way for all three types.
//
// Usage:
//   node change-status.mjs <id-or-url> <newState>

import { loadReleasyConfig, isValidStatus } from './releasy-config.mjs';
import { loadPat, getWorkItemType, patchWorkItem, releasyWorkItemUrl, parseWorkItemId, parseArgs, fail } from './lib.mjs';

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const [idArg, newState] = positional;
  if (!idArg || !newState) fail('Usage: node change-status.mjs <id-or-url> <newState>');

  const id = parseWorkItemId(idArg);
  const cfg = loadReleasyConfig();
  const pat = loadPat();

  const type = await getWorkItemType(cfg, id, pat);
  if (!isValidStatus(cfg, type, newState)) {
    fail(`"${newState}" is not a valid status for a ${type}. Valid: ${(cfg.statusOptions[type] || []).join(', ')}.`);
  }

  await patchWorkItem(cfg, id, [{ op: 'replace', path: '/fields/System.State', value: newState }], pat);
  console.log(`${type} #${id} status changed to "${newState}" - ${releasyWorkItemUrl(id)}`);
}

main().catch((e) => fail(e.message));

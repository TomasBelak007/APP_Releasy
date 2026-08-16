// Reads the live product/release/prefix/assignee/status config straight out of the repo's
// index.html instead of keeping a second, inevitably-stale copy in this skill. See the
// "Domain knowledge" section of reference.md for exactly which `const`s these are and why.
//
// Run directly (`node releasy-config.mjs`) to print the resolved config as JSON - useful both
// for the agent (to see current products/releases/prefixes/assignees before drafting a plan)
// and for verifying this script still parses index.html correctly after it changes upstream.

import fs from 'node:fs';
import path from 'node:path';
import { SKILL_ROOT } from './lib.mjs';

/** Walks up from this skill's own folder looking for the repo's index.html. */
function findIndexHtml() {
  let dir = SKILL_ROOT;
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'index.html');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate index.html by walking up from .cursor/skills/releasy-ai/ - ' +
    'is this skill still inside the Releasy repo?'
  );
}

/**
 * Extracts the source text of `const <name> = <expr>;` (everything between `=` and the
 * top-level `;`, so it also covers chained calls like RATING_LEVELS' trailing `.map(...)`).
 * Tracks string/bracket state so semicolons and brackets inside string literals don't confuse
 * the scan; does not need to be a full JS parser since index.html's own consts are simple
 * literals (plus that one `.map()` chain).
 */
function findConstStatementSource(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=`, 'm');
  const m = re.exec(source);
  if (!m) {
    throw new Error(
      `Could not find "const ${name} = ..." in index.html - has it been renamed or removed? ` +
      `If so, update releasy-config.mjs (and review the rest of .cursor/skills/releasy-ai/ per ` +
      `the AGENTS.md reminder).`
    );
  }
  let i = m.index + m[0].length;
  while (i < source.length && /\s/.test(source[i])) i++;
  const start = i;
  let depth = 0;
  let inString = null;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (ch === ';' && depth === 0) break;
  }
  if (i >= source.length) {
    throw new Error(`Could not find the end of "const ${name}" in index.html (unterminated statement?).`);
  }
  return source.slice(start, i);
}

function extractConst(source, name) {
  const text = findConstStatementSource(source, name);
  try {
    // index.html is a local, trusted file in this same repo - evaluating its own literal
    // const declarations here is equivalent to what the browser already does when it loads it.
    // eslint-disable-next-line no-new-func
    return new Function(`return (${text});`)();
  } catch (e) {
    throw new Error(`Failed to evaluate "const ${name}" read from index.html: ${e.message}`);
  }
}

export function loadReleasyConfig() {
  const indexPath = findIndexHtml();
  const source = fs.readFileSync(indexPath, 'utf8');

  const config = extractConst(source, 'config');
  const releaseNames = extractConst(source, 'releaseNames');
  const titlePrefixes = extractConst(source, 'titlePrefixes');
  const titlePrefixesTask = extractConst(source, 'titlePrefixesTask');
  const availablePatchVersions = extractConst(source, 'availablePatchVersions');
  const assignees = extractConst(source, 'assignees');
  const ratingLevels = extractConst(source, 'RATING_LEVELS');
  const statusOptions = extractConst(source, 'statusOptions');

  return {
    indexPath,
    organization: config.organization,
    project: config.project,
    releaseNames,
    titlePrefixes,
    titlePrefixesTask,
    availablePatchVersions,
    assignees,
    ratingLevels,
    statusOptions
  };
}

// ===== Validation helpers shared by the other scripts =====

export function findEpicId(cfg, releaseName) {
  // Matches createWorkItem()'s own lookup in index.html exactly (by release name only, not
  // product) - each product currently has a distinct release name so this is unambiguous, but
  // keep it faithful to the real app rather than "improving" it here.
  const entry = cfg.releaseNames.find((r) => r.release === releaseName);
  return entry ? entry.epicID : null;
}

export function findProductPrefixes(cfg, product) {
  return cfg.titlePrefixes[product] || null;
}

export function isValidPrefix(cfg, type, product, prefix) {
  if (type === 'Task') return cfg.titlePrefixesTask.includes(prefix);
  const prefixes = findProductPrefixes(cfg, product);
  return !!prefixes && prefixes.includes(prefix);
}

export function findVersionEntry(cfg, product, release, major) {
  const productEntry = cfg.availablePatchVersions.find((p) => p.product === product);
  if (!productEntry) return null;
  const versionKey = `${release}-${major}`;
  return productEntry.versions.find((v) => v.version === versionKey) || null;
}

export function isValidPatch(cfg, product, release, major, patch) {
  const version = findVersionEntry(cfg, product, release, major);
  return !!version && version.patches.includes(patch);
}

/** Every "<release>-<major>" version entry configured for a product under one release name -
 * used to auto-resolve `major` when the caller only gave a release (list-tickets.mjs), and to
 * list the options when that resolution is ambiguous. */
export function findMajorsForRelease(cfg, product, release) {
  const productEntry = cfg.availablePatchVersions.find((p) => p.product === product);
  if (!productEntry) return [];
  const prefix = `${release}-`;
  return productEntry.versions
    .filter((v) => v.version.startsWith(prefix))
    .map((v) => v.version.slice(prefix.length));
}

export function isValidAssignee(cfg, email) {
  if (!email) return true; // unassigned is always fine
  return cfg.assignees.some((a) => a.email.toLowerCase() === String(email).toLowerCase());
}

export function isValidPriority(value) {
  return ['1', '2', '3', '4'].includes(String(value));
}

/** Accepts either the bare digit ('2') or the full label ('2 - High') and returns the label
 * Azure DevOps expects to be stored for Severity. */
export function resolveSeverityLabel(cfg, value) {
  const str = String(value ?? '').trim();
  const byValue = cfg.ratingLevels.find((l) => l.value === str);
  if (byValue) return byValue.label;
  const byLabel = cfg.ratingLevels.find((l) => l.label === str);
  return byLabel ? byLabel.label : null;
}

export function isValidTshirtSize(value) {
  return ['S', 'M', 'L'].includes(String(value));
}

export function isValidStatus(cfg, type, status) {
  return (cfg.statusOptions[type] || []).includes(status);
}

/** Mirrors parseReleaseVersion() in index.html: "Labe-07.999" -> { name, major, patch }. */
export function parseReleaseVersion(platformRelease) {
  const match = String(platformRelease || '').match(/([A-Za-z]+)-(\d{2})\.(\d{3})/);
  return match ? { name: match[1], major: match[2], patch: match[3] } : null;
}

/**
 * Mirrors resolveProductForWorkItem() in index.html. Deliberately does NOT read
 * `fields['System.Tags']` directly - Azure DevOps lower-cases Tags on save (confirmed against
 * the real API: a Bug created with Tags "Xeelo" comes back as "xeelo"), which would break every
 * exact-case lookup against `titlePrefixes`/`availablePatchVersions` downstream. Resolve the
 * properly-cased product from PlatformRelease -> releaseNames instead, falling back to matching
 * the title's own prefix.
 */
export function resolveProduct(cfg, fields) {
  const version = parseReleaseVersion(fields['Custom.PlatformRelease']);
  if (version) {
    const releaseConfig = cfg.releaseNames.find((r) => r.release === version.name);
    if (releaseConfig) return releaseConfig.product;
  }
  const title = fields['System.Title'] || '';
  for (const [product, prefixes] of Object.entries(cfg.titlePrefixes)) {
    if (prefixes.some((prefix) => title.startsWith(prefix))) return product;
  }
  return null;
}

// CLI entry point: `node releasy-config.mjs` prints the live config as JSON.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(loadReleasyConfig(), null, 2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

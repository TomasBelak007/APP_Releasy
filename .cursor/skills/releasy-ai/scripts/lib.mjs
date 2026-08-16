// Shared low-level helpers for the releasy-ai scripts: credentials, HTTP against the Azure
// DevOps REST API, and small CLI conveniences. Kept dependency-free (plain Node, native fetch)
// to match the no-build-step ethos of the rest of the repo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = path.dirname(SCRIPTS_DIR);

/**
 * Reads AZURE_DEVOPS_PAT from the environment, falling back to
 * `.cursor/skills/releasy-ai/.env` (git-ignored, see .env.example). This is a dedicated
 * credential separate from the repo's own `dev.env` - see AGENTS.md.
 */
export function loadPat() {
  if (process.env.AZURE_DEVOPS_PAT && process.env.AZURE_DEVOPS_PAT.trim()) {
    return process.env.AZURE_DEVOPS_PAT.trim();
  }
  const envPath = path.join(SKILL_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key !== 'AZURE_DEVOPS_PAT') continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  throw new Error(
    `No PAT found. Copy ${path.join(SKILL_ROOT, '.env.example')} to ` +
    `${envPath} and fill in AZURE_DEVOPS_PAT=..., or export AZURE_DEVOPS_PAT in the environment.`
  );
}

export function apiBase(cfg) {
  return `https://dev.azure.com/${cfg.organization}/${cfg.project}/_apis`;
}

// Where Releasy itself is hosted - the app's own work-item deep link (?workitem=<id>), used
// instead of the raw Azure DevOps _workitems/edit URL so links printed by these scripts open in
// Releasy (see getWorkItemUrl() in index.html, which builds the same ?workitem= link from
// window.location.href since it already runs on this page).
const RELEASY_APP_URL = 'https://provisioning.integray.app/api/endpoint/web-app/azure-devops/release-overview';

export function releasyWorkItemUrl(id) {
  return `${RELEASY_APP_URL}?workitem=${id}`;
}

function authHeader(pat) {
  return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
}

/** Thin wrapper around fetch: auth header, JSON parsing, and a readable Error on non-2xx. */
export async function devOpsFetch(url, { method = 'GET', pat, body, contentType } = {}) {
  const headers = { Authorization: authHeader(pat), Accept: 'application/json' };
  if (method !== 'GET' && method !== 'DELETE') {
    headers['Content-Type'] = contentType || 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const detail = data && typeof data === 'object' && data.message ? data.message : text;
    throw new Error(`Azure DevOps API error ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return data;
}

export async function patchWorkItem(cfg, id, operations, pat) {
  const url = `${apiBase(cfg)}/wit/workitems/${id}?api-version=7.1`;
  return devOpsFetch(url, { method: 'PATCH', pat, body: operations, contentType: 'application/json-patch+json' });
}

export async function createWorkItemApi(cfg, type, operations, pat) {
  const url = `${apiBase(cfg)}/wit/workitems/$${type}?api-version=7.1`;
  return devOpsFetch(url, { method: 'POST', pat, body: operations, contentType: 'application/json-patch+json' });
}

/** Escapes a value for embedding in a single-quoted WIQL string literal. */
export function escapeWiqlString(value) {
  return String(value).replace(/'/g, "''");
}

/** Mirrors fetchWIQL() in index.html - runs a WIQL query and returns the matching work item IDs
 * (WIQL itself only ever returns IDs; fetch full fields separately via getWorkItemsBatch()). */
export async function runWiql(cfg, query, pat) {
  const url = `${apiBase(cfg)}/wit/wiql?api-version=7.1`;
  return devOpsFetch(url, { method: 'POST', pat, body: { query } });
}

export async function getWorkItem(cfg, id, pat, { expandRelations = false } = {}) {
  const url = `${apiBase(cfg)}/wit/workitems/${id}?${expandRelations ? '$expand=Relations&' : ''}api-version=7.1`;
  return devOpsFetch(url, { pat });
}

// The "get work items by ID" endpoint rejects more than 200 IDs per call (VS403474) - list-tickets.mjs
// can easily exceed that for an unfiltered whole-release query, so chunk transparently here rather
// than making every caller worry about it.
const MAX_WORK_ITEMS_BATCH = 200;

export async function getWorkItemsBatch(cfg, ids, pat, { expandRelations = false } = {}) {
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += MAX_WORK_ITEMS_BATCH) {
    chunks.push(ids.slice(i, i + MAX_WORK_ITEMS_BATCH));
  }
  const results = await Promise.all(chunks.map(async (chunk) => {
    const url = `${apiBase(cfg)}/wit/workitems?ids=${chunk.join(',')}${expandRelations ? '&$expand=relations' : ''}&api-version=7.1`;
    const data = await devOpsFetch(url, { pat });
    return data.value || [];
  }));
  return results.flat();
}

/** Just enough of a GET to answer "what type is this item" - used before every write to an
 * existing item so scripts can enforce per-type rules (Task can't take comments, etc). */
export async function getWorkItemType(cfg, id, pat) {
  const data = await getWorkItem(cfg, id, pat);
  const type = data.fields?.['System.WorkItemType'];
  if (!type) throw new Error(`Work item #${id} has no System.WorkItemType - does it exist in ${cfg.organization}/${cfg.project}?`);
  return type;
}

/** Accepts a bare numeric ID, a Releasy "?workitem=<id>" link, or a full DevOps
 * "_workitems/edit/<id>" URL. */
export function parseWorkItemId(input) {
  const str = String(input).trim();
  const workitemParamMatch = str.match(/[?&]workitem=(\d+)/i);
  if (workitemParamMatch) return parseInt(workitemParamMatch[1], 10);
  const devOpsUrlMatch = str.match(/workitems\/edit\/(\d+)/i);
  if (devOpsUrlMatch) return parseInt(devOpsUrlMatch[1], 10);
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  throw new Error(`Could not parse a work item ID from "${input}" - pass a numeric ID, a Releasy ?workitem=<id> link, or a DevOps _workitems/edit/<id> URL.`);
}

/** Minimal `--flag value` / `--flag` parser - no positional/flag ordering requirements. */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** `--description "..."` or `--description-file path` - mutually exclusive, file wins if both given. */
export function readTextFlag(flags, inlineKey, fileKey) {
  if (flags[fileKey]) return fs.readFileSync(String(flags[fileKey]), 'utf8');
  if (typeof flags[inlineKey] === 'string') return flags[inlineKey];
  return undefined;
}

/** Mirrors fetchWorkItemCommentsAll() in index.html: paginates via continuationToken, requests
 * renderedText so Markdown comments come back with their server-rendered HTML too. */
export async function fetchAllComments(cfg, id, pat) {
  const base = `${apiBase(cfg)}/wit/workitems/${id}/comments`;
  const all = [];
  let continuationToken = null;
  do {
    const url = new URL(base);
    url.searchParams.set('api-version', '7.1-preview.4');
    url.searchParams.set('$top', '200');
    url.searchParams.set('$expand', 'renderedText');
    if (continuationToken) url.searchParams.set('continuationToken', continuationToken);
    const data = await devOpsFetch(url.toString(), { pat });
    all.push(...(data.comments || []));
    continuationToken = data.continuationToken || null;
  } while (continuationToken);
  all.sort((a, b) => new Date(b.createdDate || b.modifiedDate || 0) - new Date(a.createdDate || a.modifiedDate || 0));
  return all;
}

/** Same shape as mapCommentForDisplay() in index.html, minus the relative-date label (not
 * meaningful outside the browser UI) - keeps `format` explicit instead. */
export function mapComment(comment) {
  return {
    id: comment.id,
    author: comment.createdBy?.displayName || comment.createdBy?.uniqueName || 'Unknown',
    createdDate: comment.createdDate || comment.modifiedDate || null,
    format: (comment.format || 'html').toLowerCase() === 'markdown' ? 'Markdown' : 'Html',
    text: comment.text || '',
    renderedText: comment.renderedText || null
  };
}

/** Mirrors getHierarchyParentId() in index.html - a Task's parent Bug/Feature is the other end
 * of its Hierarchy-Reverse relation. */
export function getHierarchyParentId(relations) {
  if (!Array.isArray(relations)) return null;
  const parentRel = relations.find((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
  if (!parentRel?.url) return null;
  const match = String(parentRel.url).match(/\/workitems\/(\d+)(?:\?|$)/i);
  return match ? parseInt(match[1], 10) : null;
}

/** Child Tasks are found via the Hierarchy-Forward relation on the parent (index.html's
 * fetchChildTasksForWorkItems()), then batch-fetched for their own fields. */
export async function fetchChildTasks(cfg, parentId, relations, pat) {
  const childIds = (relations || [])
    .filter((r) => r.rel === 'System.LinkTypes.Hierarchy-Forward')
    .map((r) => parseInt(String(r.url).split('/').pop(), 10))
    .filter((id) => Number.isInteger(id));
  if (!childIds.length) return [];
  const tasks = await getWorkItemsBatch(cfg, childIds, pat);
  return tasks.filter((t) => t.fields['System.WorkItemType'] === 'Task');
}

export function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

export function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

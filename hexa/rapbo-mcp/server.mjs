#!/usr/bin/env node
// Hexa RAP-BO resolver MCP server.
//
// Purpose: an ATC "successor available" finding often points at a *read-only* CDS
// view. That is a navigation clue, not a dead-end: a read CDS view is frequently the
// projection of a RAP Business Object, and a released `API_*_SRV` OData service is
// generated from a service definition over a CDS entity. This server follows those
// metadata links over ADT REST to tell you whether a real ON-STACK write target
// (a RAP behavior definition) exists behind the successor — turning "it's just an
// OData service, you can't use it on-stack" into a concrete lead:
//   OData service → service definition → exposed CDS entity → behavior definition (BO).
//
// It assesses/resolves only — it never writes to the backend (all GET requests).
//
// Auth: credentials come from the environment only (never a tool argument, never
// surfaced to the model). Reuses the same env contract as hexa-atc-mcp so an
// existing cookie/basic config can be copied verbatim.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { XMLParser } from "fast-xml-parser";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Configuration (all from environment — see README)
// ---------------------------------------------------------------------------

const BASE_URL = (
  process.env.H1E_BASE_URL || "https://azlsaph1eas01.int.pg.com:8443"
).replace(/\/+$/, "");
const SAP_CLIENT = process.env.H1E_CLIENT || "104";
const TLS_INSECURE =
  String(process.env.H1E_TLS_INSECURE ?? "true").toLowerCase() === "true";

// Internal hosts commonly present a self-signed / private-CA certificate. When
// requested, relax TLS verification for this process only.
if (TLS_INSECURE) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/** Resolve the SSO cookie from env or a git-ignored file. Never from a tool arg. */
function getCookie() {
  let raw;
  if (process.env.H1E_COOKIE && process.env.H1E_COOKIE.trim()) {
    raw = process.env.H1E_COOKIE;
  } else if (process.env.H1E_COOKIE_FILE) {
    try {
      raw = readFileSync(process.env.H1E_COOKIE_FILE, "utf8");
    } catch (err) {
      throw new Error(
        `H1E_COOKIE_FILE set but unreadable (${process.env.H1E_COOKIE_FILE}): ${err.message}`
      );
    }
  } else {
    throw new Error(
      "No SSO cookie configured. Set H1E_COOKIE or H1E_COOKIE_FILE in the MCP server env."
    );
  }
  const cookie = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("; ")
    .replace(/;\s*;/g, ";")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim();
  if (!cookie) throw new Error("Configured cookie is empty after normalization.");
  return cookie;
}

/** Build auth header(s): HTTP Basic if provided, else session cookie. Env only. */
function getAuth() {
  const user = process.env.H1E_USER && process.env.H1E_USER.trim();
  let pass = process.env.H1E_PASSWORD;
  if (user && !pass && process.env.H1E_PASSWORD_FILE) {
    try {
      pass = readFileSync(process.env.H1E_PASSWORD_FILE, "utf8").trim();
    } catch (err) {
      throw new Error(
        `H1E_PASSWORD_FILE set but unreadable (${process.env.H1E_PASSWORD_FILE}): ${err.message}`
      );
    }
  }
  if (user && pass) {
    return { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
  }
  if (process.env.H1E_COOKIE || process.env.H1E_COOKIE_FILE) {
    return { Cookie: getCookie() };
  }
  throw new Error(
    "No credentials configured. Set H1E_USER + H1E_PASSWORD (recommended) or H1E_COOKIE / H1E_COOKIE_FILE."
  );
}

function withClient(path) {
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${sep}sap-client=${encodeURIComponent(SAP_CLIENT)}`;
}

async function adtGet(path, accept) {
  const url = withClient(path);
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: accept, ...getAuth(), "User-Agent": "hexa-rapbo-mcp" },
  });
  const body = await res.text();
  if (!res.ok) {
    const snippet = body.slice(0, 400);
    throw new Error(
      `ADT GET ${path} → HTTP ${res.status} ${res.statusText}. ${
        res.status === 401 || res.status === 403
          ? "Auth likely expired — refresh your SSO session / cookie. "
          : ""
      }${snippet ? `Response: ${snippet}` : ""}`
    );
  }
  // A valid session returns text/plain (source) or application/xml (search). An HTML body
  // is the SSO logon page returned with HTTP 200 when the cookie expired — treat it as an
  // auth error rather than silently reading it as "no results" (a false miss that would
  // otherwise be cached and poison the resolution chain).
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html") || /sap-system-login|saphtmlmoduleoutput|window\.location\.hash/i.test(body.slice(0, 800))) {
    throw new Error(`ADT GET ${path} → not authenticated (received a logon page). Refresh the SSO cookie in the server environment.`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// XML parsing
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false,
});
const toArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const attr = (node, name) => (node ? node[`@_${name}`] : undefined);

/** Parse an ADT repository quickSearch response into objectReference rows. */
function parseSearch(xml) {
  const doc = parser.parse(xml);
  const refs = toArray(doc.objectReferences?.objectReference);
  return refs.map((r) => ({
    name: attr(r, "name"),
    type: attr(r, "type"),
    uri: attr(r, "uri"),
    package: attr(r, "packageName"),
    description: attr(r, "description"),
  }));
}

/** quickSearch for objects by name (+optional ADT type like DDLS, BDEF, SRVD, SRVB). */
async function quickSearch(name, type, max = 50) {
  const t = type ? String(type).replace(/\/.*$/, "") : undefined;
  const qs = new URLSearchParams({ operation: "quickSearch", query: name, maxResults: String(max) });
  if (t) qs.set("objectType", t);
  const xml = await adtGet(
    `/sap/bc/adt/repository/informationsystem/search?${qs.toString()}`,
    "application/*"
  );
  return parseSearch(xml);
}

/** Find the exact-name object of a given ADT type; returns the objectReference or null. */
async function findExact(name, type) {
  const rows = await quickSearch(name, type);
  const t = type ? String(type).replace(/\/.*$/, "").toUpperCase() : undefined;
  return (
    rows.find(
      (r) =>
        (r.name || "").toUpperCase() === name.toUpperCase() &&
        (!t || (r.type || "").toUpperCase().startsWith(t))
    ) || null
  );
}

/** Read the text source of an ADT object from its objectReference uri. */
async function readSource(uri) {
  // Text-based repository objects (DDLS/BDEF/SRVD) expose /source/main.
  return adtGet(`${uri.replace(/\/source\/main$/, "")}/source/main`, "text/plain, application/*");
}

// ---------------------------------------------------------------------------
// Source loading — deterministic ADT URI first, quickSearch fallback, TTL-cached.
// The server is long-lived and shared, so a small TTL cache avoids re-fetching the
// same CDS/BDEF sources across a deep field climb and across calls, without ever
// serving an object older than the TTL. Accuracy is never traded: a direct-URI miss
// falls back to quickSearch, and an auth/logon error surfaces (never cached).
// ---------------------------------------------------------------------------

const SOURCE_PATHS = {
  DDLS: (n) => `/sap/bc/adt/ddic/ddl/sources/${n.toLowerCase()}/source/main`,
  BDEF: (n) => `/sap/bc/adt/bo/behaviordefinitions/${n.toLowerCase()}/source/main`,
};
const SOURCE_TTL_MS = 10 * 60 * 1000;
const sourceCache = new Map(); // `${KIND}:${NAME}` -> { at, value }
const srcByUriCache = new Map(); // uri -> { at, src }

async function tryGet(path, accept) {
  try {
    return await adtGet(path, accept);
  } catch {
    return null; // 404 / wrong path → let the caller fall back (auth errors re-throw via findExact)
  }
}

/**
 * Load an object's source by name: one deterministic GET (which both confirms
 * existence and returns the source); on miss, fall back to quickSearch + read so
 * accuracy is never lost. TTL-cached. Returns { name, uri, src, package } or null.
 */
async function loadSource(kind, name) {
  const key = `${kind}:${name.toUpperCase()}`;
  const hit = sourceCache.get(key);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.value;

  let value = null;
  const direct = SOURCE_PATHS[kind] && SOURCE_PATHS[kind](name);
  if (direct) {
    const src = await tryGet(direct, "text/plain, application/*");
    if (src) value = { name, uri: direct.replace(/\/source\/main$/, ""), src, package: null };
  }
  if (!value) {
    const ref = await findExact(name, kind); // re-throws a clear auth error if unauthenticated
    if (ref) {
      const src = await tryGet(`${ref.uri.replace(/\/source\/main$/, "")}/source/main`, "text/plain, application/*");
      value = { name: ref.name, uri: ref.uri, src: src || null, package: ref.package || null };
    }
  }
  sourceCache.set(key, { at: Date.now(), value });
  return value;
}

/** Read a source by its known ADT uri, TTL-cached. */
async function readSourceCached(uri) {
  const hit = srcByUriCache.get(uri);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.src;
  const src = await readSource(uri);
  srcByUriCache.set(uri, { at: Date.now(), src });
  return src;
}

// ---------------------------------------------------------------------------
// Source parsing (light, tolerant — these are leads, not a compiler)
// ---------------------------------------------------------------------------

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/^\s*\/\/.*$/gm, " ") // line comments //
    .replace(/^\s*\*.*$/gm, " "); // ABAP-style * comments

/** Root entity name from a CDS DDL source (view entity / view / projection). */
function cdsRootEntity(src) {
  const s = stripComments(src);
  const m =
    s.match(/define\s+root\s+view\s+entity\s+([A-Za-z0-9_]+)/i) ||
    s.match(/define\s+view\s+entity\s+([A-Za-z0-9_]+)/i) ||
    s.match(/define\s+root\s+abstract\s+entity\s+([A-Za-z0-9_]+)/i) ||
    s.match(/define\s+view\s+([A-Za-z0-9_]+)/i);
  const isProjection = /define\s+(root\s+)?view\s+entity\s+[A-Za-z0-9_]+\s+as\s+projection\s+on/i.test(s);
  const providesQuery = /provider\s+contract\s+transactional_query/i.test(s);
  return { entity: m ? m[1] : null, isProjection, providesQuery };
}

/** Parse a behavior definition source into implementation type + per-entity ops. */
function parseBdef(src, field) {
  const s = stripComments(src);
  // The kind is the first keyword of the definition: managed / unmanaged / abstract
  // / projection / interface (interface & projection BDEFs have no managed keyword).
  const kinds = ["managed", "unmanaged", "abstract", "projection", "interface"];
  const firstTok = s.trim().match(/^([A-Za-z_]+)/);
  let implementationType =
    firstTok && kinds.includes(firstTok[1].toLowerCase())
      ? firstTok[1].toLowerCase()
      : (s.match(/\b(managed|unmanaged|abstract|projection|interface)\b/i)?.[1]?.toLowerCase() ?? "unknown");
  const strict = /\bstrict\s*\(/i.test(s) || /\bstrict\b/i.test(s);

  const entities = [];
  // Split on each "define behavior for <Entity>" (± "alias").
  const re = /define\s+behavior\s+for\s+([A-Za-z0-9_]+)([\s\S]*?)(?=define\s+behavior\s+for\s+|$)/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const entity = m[1];
    const block = m[2] || "";
    const has = (op) =>
      new RegExp(`(^|[^A-Za-z_])(use\\s+)?${op}\\s*;`, "im").test(block) ||
      new RegExp(`(^|[^A-Za-z_])(use\\s+)?${op}\\b`, "im").test(block);
    entities.push({
      entity,
      create: has("create"),
      update: has("update"),
      delete: has("delete"),
      hasActions: /(^|[^A-Za-z_])action\s+[A-Za-z0-9_]+/im.test(block),
    });
  }
  const fieldMentioned =
    field && field.trim()
      ? new RegExp(`\\b${field.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s)
      : null;
  return { implementationType, strict, entities, fieldMentioned };
}

/** Exposed CDS entities from a service definition source (`expose <E> [as <A>];`). */
function parseSrvdExposes(src) {
  const s = stripComments(src);
  const out = [];
  const re = /expose\s+([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?/gi;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ entity: m[1], alias: m[2] || null });
  return out;
}

// ---------------------------------------------------------------------------
// Core resolvers
// ---------------------------------------------------------------------------

/**
 * Given a CDS view name, find the behavior definition (RAP BO) behind it, if any.
 * Behavior definitions are named after their root entity, so we try the view's own
 * name and its parsed root entity as BDEF candidates.
 */
/**
 * Parse the released/API contract from a CDS source. Recognises the VDM contract
 * annotation (@VDM.lifecycle.contract.type: #PUBLIC_LOCAL_API / #PUBLIC_REMOTE_API)
 * and the older @API.state. onStackWrite distinguishes a local on-stack API (usable
 * for EML MODIFY ENTITIES) from a remote/side-by-side-only API.
 */
function parseReleaseState(src) {
  if (!src) return { released: null, contractType: null, viewType: null, apiState: null, onStackWrite: null };
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  const contractType = (clean.match(/lifecycle\.contract\.type\s*:\s*#?([A-Z_]+)/i) || [])[1] || null;
  const viewType = (clean.match(/viewType\s*:\s*#?([A-Z_]+)/i) || [])[1] || null;
  const apiState = (clean.match(/@API\.state\s*:\s*#?'?([A-Z_]+)'?/i) || [])[1] || null;
  const ct = (contractType || "").toUpperCase();
  const st = (apiState || "").toUpperCase();
  let released = null;
  let onStackWrite = null;
  if (ct || st) {
    released = (/PUBLIC|RELEASED/.test(ct + st)) && !/PRIVATE/.test(ct);
    if (/LOCAL/.test(ct)) onStackWrite = true;
    else if (/REMOTE/.test(ct)) onStackWrite = false; // remote / side-by-side only
    else if (/RELEASED/.test(st)) onStackWrite = true; // generic released → assume on-stack (verify)
    else onStackWrite = null;
  }
  return { released, contractType, viewType, apiState, onStackWrite };
}

async function resolveRapBoFromCds(cdsView, fields, table) {
  const notes = [];
  const fieldList = (Array.isArray(fields) ? fields : fields ? [fields] : [])
    .map((f) => String(f).trim())
    .filter(Boolean);
  const field = fieldList[0]; // primary field (back-compat for single-field checks)
  const cds = await loadSource("DDLS", cdsView);
  if (!cds || !cds.src) {
    return {
      input: { cdsView, fields: fieldList, table: table || null },
      cdsResolved: false,
      verdict: "cds_not_found",
      confidence: "certain",
      notes: [`CDS view '${cdsView}' not found (no DDLS source via direct URI or quickSearch).`],
    };
  }

  const cdsSrc = cds.src;
  const root = { ...cdsRootEntity(cdsSrc), _read: true };
  const rootEntity = root.entity || cdsView;
  const releaseState = parseReleaseState(cdsSrc);

  // Candidate BDEF names: the root entity and the view name itself (looked up in parallel).
  const candidates = [...new Set([rootEntity, cdsView].filter(Boolean))];
  const bdefRefs = await Promise.all(candidates.map((c) => findExact(c, "BDEF").catch(() => null)));
  const bdefRef = bdefRefs.find(Boolean) || null;

  if (!bdefRef) {
    return {
      input: { cdsView, fields: fieldList, table: table || null },
      cdsResolved: true,
      rootEntity,
      isProjection: root.isProjection,
      releaseState,
      behaviorDefinition: null,
      fieldMappings: [],
      verdict: "no_onstack_bo",
      confidence: "likely",
      fixApproach: {
        level: "B",
        writeTarget: null,
        mappedFields: [],
        unmappedFields: table ? fieldList.map((f) => `${table}.${f}`) : [],
        recommendation: `No on-stack RAP BO behind '${cdsView}' (basic/read view). Climb to the transactional/released entity or resolve via the API Hub; otherwise use a classic released API on-stack (Level B).`,
      },
      notes: [
        `No behavior definition found for ${candidates.join(" / ")}.`,
        "This CDS view has no on-stack RAP write target — treat its OData/A2X service as side-by-side only and fall back to a classic (Level B) API on-stack.",
        ...notes,
      ],
      leadTrail: `${cdsView} (CDS, read) → no BDEF → OData side-by-side / classic BAPI on-stack`,
    };
  }

  let bdef = { implementationType: "unknown", strict: false, entities: [], fieldMentioned: null };
  try {
    const src = await readSourceCached(bdefRef.uri);
    bdef = parseBdef(src, field);
  } catch (e) {
    notes.push(`Behavior definition found but source unreadable (${e.message}).`);
  }

  const rootBeh =
    bdef.entities.find((e) => e.entity.toUpperCase() === rootEntity.toUpperCase()) ||
    bdef.entities[0] ||
    null;
  const writable = !!(rootBeh && (rootBeh.create || rootBeh.update || rootBeh.delete));

  // Same-call field mapping (multi-field: a DDIC write often touches several columns).
  // Sources are cached, so each extra field is cheap.
  const fieldMappings = [];
  if (table && fieldList.length) {
    for (const f of fieldList) {
      const rf = await resolveField(rootEntity, table, f, 6);
      fieldMappings.push({
        table,
        field: f,
        exposed: rf.exposed,
        exposedName: rf.exposedName,
        status: rf.status,
        trail: rf.trail,
      });
    }
  }
  const fieldMapping = fieldMappings[0] || null; // back-compat (primary field)

  // Fix approach: consolidate BO + release contract + field mappings into a route the
  // remediation agent turns into code. EML is a real on-stack Level A target only when the
  // BDEF is a concrete (non-abstract) writable BO released under a LOCAL contract.
  const isAbstract = bdef.implementationType === "abstract";
  const emlTarget = writable && !isAbstract && releaseState.onStackWrite === true;
  const mapped = fieldMappings.filter((m) => m.exposed);
  const unmapped = fieldMappings.filter((m) => !m.exposed);
  const mapStr = (arr) => arr.map((m) => `${m.field}→${m.exposedName}`).join(", ");

  let level;
  let recommendation;
  if (emlTarget) {
    if (fieldMappings.length === 0) {
      level = "A";
      recommendation = `Level A — EML MODIFY ENTITIES ${rootEntity} on released BO ${bdefRef.name} (${releaseState.contractType}). Pass table + fields to map the written columns. Verify C1 on the target release.`;
    } else if (unmapped.length === 0) {
      level = "A";
      recommendation = `Level A — EML MODIFY ENTITIES ${rootEntity} on released BO ${bdefRef.name} (${releaseState.contractType}). Write field(s): ${mapStr(mapped)}. Verify field write-exposure (not read-only) and C1 on the target release.`;
    } else if (mapped.length) {
      level = "A_partial";
      recommendation = `Level A for ${mapStr(mapped)} via EML MODIFY ENTITIES ${rootEntity} on ${bdefRef.name}. Residual not exposed on the BO: ${unmapped.map((m) => m.field).join(", ")} → Level B (classic API) or redesign for those.`;
    } else {
      level = "B";
      recommendation = `BO ${bdefRef.name} is a released on-stack Level A target (${releaseState.contractType}), but the requested field(s) ${unmapped.map((m) => m.field).join(", ")} are not exposed on it (renamed / derived / read-only). Use the correct exposed element, or Level B (classic API) for these fields.`;
    }
  } else if (writable && isAbstract) {
    level = "B";
    recommendation = `No on-stack Level A — BDEF ${bdefRef.name} is abstract (no on-stack runtime; OData-only). Use a classic released API on-stack (Level B, e.g. BAPI_*_CHANGE).`;
  } else if (writable && releaseState.onStackWrite === false) {
    level = "B";
    recommendation = `No on-stack Level A — BO ${bdefRef.name} is released as ${releaseState.contractType} (remote / side-by-side only). Use a classic released API on-stack (Level B).`;
  } else if (writable && releaseState.released !== true) {
    level = "B";
    recommendation = `No on-stack Level A — BO ${bdefRef.name} is not released for on-stack use (${releaseState.contractType || "no contract"}). Use a classic released API (Level B), or a local-contract released BO if one exists.`;
  } else {
    level = "B";
    recommendation = `No usable on-stack Level A write path. Use a classic released API (Level B) or redesign.`;
  }

  const levelA = level === "A" || level === "A_partial";
  const fixApproach = {
    level,
    writeTarget: levelA
      ? { boName: bdefRef.name, entity: rootEntity, eml: `MODIFY ENTITIES ${rootEntity}`, releaseContract: releaseState.contractType }
      : null,
    mappedFields: mapped.map((m) => ({ db: `${m.table}.${m.field}`, boElement: m.exposedName })),
    unmappedFields: unmapped.map((m) => `${m.table}.${m.field}`),
    recommendation,
  };

  const fieldNote = fieldMappings.length
    ? `Fields: ${mapped.length ? `mapped ${mapStr(mapped)}` : "none mapped"}${unmapped.length ? `; unmapped ${unmapped.map((m) => m.field).join(", ")}` : ""}.`
    : field
    ? bdef.fieldMentioned === true
      ? `Field '${field}' is referenced in the behavior definition (verify it is writable, not read-only).`
      : `Field '${field}' not found in the behavior definition source — pass 'table' too to resolve its exposed element.`
    : "Pass 'table' + 'fields' to also resolve the write field mappings.";

  return {
    input: { cdsView, fields: fieldList, table: table || null },
    cdsResolved: true,
    rootEntity,
    isProjection: root.isProjection,
    releaseState,
    behaviorDefinition: {
      name: bdefRef.name,
      uri: bdefRef.uri,
      package: bdefRef.package,
      implementationType: bdef.implementationType,
      strict: bdef.strict,
      entities: bdef.entities,
      writable,
      fieldMentioned: bdef.fieldMentioned,
    },
    fieldMappings,
    fieldMapping,
    fixApproach,
    verdict: writable ? "onstack_bo_writable" : "bo_found_not_writable",
    confidence: "likely",
    notes: [
      writable
        ? `On-stack RAP BO '${bdefRef.name}' (${bdef.implementationType}) exposes ${["create", "update", "delete"]
            .filter((op) => rootBeh && rootBeh[op])
            .join("/")} — candidate Level A write via EML (MODIFY ENTITIES).`
        : `Behavior definition '${bdefRef.name}' found but no create/update/delete detected on the root — verify before treating as a write target.`,
      fieldNote,
      releaseState.released === false
        ? `Release: NOT released (${releaseState.contractType || releaseState.apiState || "no contract annotation"}) — not a clean-core target; verify.`
        : releaseState.onStackWrite === false
        ? `Release: released as ${releaseState.contractType} (remote / side-by-side OData) — NOT an on-stack EML write target; for on-stack use fall back to Level B (classic API) or a local-contract released BO.`
        : releaseState.released
        ? `Release: released (${releaseState.contractType || releaseState.apiState}) — on-stack EML candidate; still verify C1 on your target release.`
        : `Release: contract annotation not found on '${cdsView}' — verify release state before treating as Level A.`,
      "Released-on-your-stack (C1 contract) and field write-exposure are NOT verified here — confirm on the target release before generating an EML fix.",
      ...notes,
    ],
    leadTrail: `${cdsView} (CDS) → ${rootEntity} → BDEF ${bdefRef.name} (${bdef.implementationType}${writable ? ", writable" : ""})`,
  };
}

/**
 * Best-effort: resolve an OData service to the CDS entity/entities it exposes, via
 * its RAP service binding → service definition. Classic (SEGW) services have no
 * service binding — for those we say so and ask for the CDS successor instead.
 */
async function resolveCdsFromOData(service) {
  const notes = [];
  const candidates = [...new Set([service, service.replace(/_SRV$/i, ""), `${service}_O4`])];
  let srvb = null;
  for (const c of candidates) {
    srvb = await findExact(c, "SRVB");
    if (srvb) break;
  }
  if (!srvb) {
    return {
      input: { odataService: service },
      verdict: "no_rap_service_binding",
      confidence: "likely",
      exposedEntities: [],
      notes: [
        `No RAP service binding (SRVB) found for '${service}'.`,
        "This is likely a classic (SEGW) OData service with no RAP stack — take the CDS successor(s) straight from the ATC finding and pass them to find_rap_bo.",
      ],
    };
  }

  // The binding references a service definition; find the SRVD by convention/name.
  let exposes = [];
  const srvdName = srvb.name; // binding and definition frequently share the base name
  const srvd = (await findExact(srvdName, "SRVD")) || (await findExact(service.replace(/_SRV$/i, ""), "SRVD"));
  if (srvd) {
    try {
      const src = await readSource(srvd.uri);
      exposes = parseSrvdExposes(src);
    } catch (e) {
      notes.push(`Service definition '${srvd.name}' found but source unreadable (${e.message}).`);
    }
  } else {
    notes.push(`Service binding '${srvb.name}' found, but its service definition could not be resolved by name.`);
  }

  return {
    input: { odataService: service },
    verdict: exposes.length ? "cds_entities_resolved" : "binding_found_entities_unresolved",
    confidence: exposes.length ? "likely" : "uncertain",
    serviceBinding: { name: srvb.name, uri: srvb.uri },
    serviceDefinition: srvd ? { name: srvd.name, uri: srvd.uri } : null,
    exposedEntities: exposes,
    notes: [
      exposes.length
        ? `Service exposes ${exposes.length} CDS entity(ies): ${exposes.map((e) => e.entity).join(", ")}. Pass the root one to find_rap_bo.`
        : "Could not parse exposed entities — open the service definition to read its `expose` list.",
      ...notes,
    ],
  };
}

// ---------------------------------------------------------------------------
// Field resolver — follow a DB field up the CDS view stack, tracking renames
// ---------------------------------------------------------------------------
//
// Generic (not tied to any specific view family): a released entity is built on
// a stack of CDS views, each `select from` / `as projection on` the one below,
// and each may rename an element (`<source> as <NewName>`). To decide whether a
// table field is exposed in a released entity we walk DOWN to the view that reads
// the table, grab the element it maps the column to, then carry that element name
// back UP through each layer's rename — bounded by a depth cap.

// Keywords that are never a source-element reference in an element expression.
const CDS_KW = new Set([
  "cast", "case", "when", "then", "else", "end", "preserving", "type", "as",
  "select", "from", "distinct", "key", "coalesce", "concat", "and", "or", "not",
  "is", "null", "abap_system_timezone", "dats_tims_to_tstmp", "session", "client",
  "left", "right", "outer", "inner", "join", "on",
]);

/** Index of the last top-level (paren-depth 0) ` as ` in an element expression. */
function lastTopLevelAs(expr) {
  let depth = 0;
  let idx = -1;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (c === " " || c === "\t") && /^as[\s(]/i.test(expr.slice(i + 1))) {
      idx = i;
    }
  }
  return idx;
}

/**
 * Parse a CDS element list body into { name, refTable, refField, refElem } rows.
 * Skips annotations (incl. multi-line), comments, and association exposures.
 */
function parseElements(body) {
  const out = [];
  const net = (str, open, close) =>
    (str.split(open).length - 1) - (str.split(close).length - 1);
  let ann = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").replace(/--.*$/, "");
    if (ann > 0) {
      ann += net(line, "{", "}") + net(line, "[", "]");
      if (ann < 0) ann = 0;
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("@")) {
      ann += net(line, "{", "}") + net(line, "[", "]");
      if (ann < 0) ann = 0;
      continue;
    }
    let expr = t.replace(/^key\s+/i, "").replace(/,\s*$/, "").trim();
    if (!expr || expr.startsWith("_")) continue; // association exposure

    const asIdx = lastTopLevelAs(expr);
    let name;
    let left;
    if (asIdx >= 0) {
      name = (expr.slice(asIdx + 4).trim().match(/^[A-Za-z0-9_]+/) || [])[0];
      left = expr.slice(0, asIdx);
    } else {
      const bare = expr.match(/^([A-Za-z0-9_]+)$/); // bare passthrough element
      const qual = expr.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/); // <alias>.<element> passthrough
      if (bare) {
        name = bare[1];
        left = bare[1];
      } else if (qual) {
        name = qual[2];
        left = expr;
      } else {
        continue;
      }
    }
    if (!name || name.startsWith("_")) continue;

    let refTable = null;
    let refField = null;
    let refElem = null;
    const tf = left.match(/\b([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/); // table.field
    if (tf) {
      refTable = tf[1];
      refField = tf[2];
    } else {
      const ids = left.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
      refElem = ids.find((x) => !CDS_KW.has(x.toLowerCase())) || name;
    }
    out.push({ name, refTable, refField, refElem });
  }
  return out;
}

/** Parse a CDS view source into its primary data source + element mappings. */
function parseCdsView(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  const fromM =
    clean.match(/as\s+select\s+from\s+([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?/i) ||
    clean.match(/\bselect\s+from\s+([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?/i) ||
    clean.match(/as\s+projection\s+on\s+([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?/i);
  const from = fromM ? fromM[1] : null;
  const fromAlias = fromM ? fromM[2] || null : null;

  // The element list is the first brace group after `define`, matched by counting.
  const defIdx = clean.search(/\bdefine\b/i);
  const open = clean.indexOf("{", defIdx >= 0 ? defIdx : 0);
  let elements = [];
  if (open >= 0) {
    let depth = 0;
    let end = -1;
    for (let i = open; i < clean.length; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    elements = parseElements(clean.slice(open + 1, end > open ? end : clean.length));
  }
  return { from, fromAlias, elements };
}

const cdsCache = new Map();
/** Read a CDS view source by name (cached). Returns null if not a resolvable DDLS. */
async function readCds(name, cache = cdsCache) {
  const key = name.toUpperCase();
  if (cache.has(key)) return cache.get(key);
  const v = await loadSource("DDLS", name);
  const val = v && v.src ? { name: v.name, uri: v.uri, src: v.src } : null;
  cache.set(key, val);
  return val;
}

/**
 * Resolve whether `entity` exposes `table.field`, following renames down to the
 * table-reading view and back up. Bounded by `depth`. Returns the exposed element
 * name (or null) plus the bottom-up rename chain for the trail.
 */
async function resolveExposedName(entity, table, field, depth, cache) {
  if (depth < 0) return { name: null, status: "inconclusive_depth", chain: [] };
  const cds = await readCds(entity, cache);
  if (!cds || !cds.src)
    return { name: null, status: "source_unreadable", chain: [{ entity, name: null }] };
  const parsed = parseCdsView(cds.src);

  // Direct: this view maps the target column itself. Match when the column is qualified
  // with the table name OR with the from-clause alias for that table (e.g. `bk.banka`
  // where the view does `select from bnka as bk`).
  const tableU = table.toUpperCase();
  const fieldU = field.toUpperCase();
  const fromU = (parsed.from || "").toUpperCase();
  const aliasU = (parsed.fromAlias || "").toUpperCase();
  const direct = parsed.elements.find(
    (e) =>
      e.refField &&
      e.refField.toUpperCase() === fieldU &&
      e.refTable &&
      (e.refTable.toUpperCase() === tableU ||
        (aliasU && e.refTable.toUpperCase() === aliasU && fromU === tableU))
  );
  if (direct)
    return {
      name: direct.name,
      status: "exposed",
      chain: [{ entity, name: direct.name, source: `${table}.${field}` }],
    };

  if (!parsed.from)
    return { name: null, status: "no_source", chain: [{ entity, name: null }] };

  // Recurse into the data source, then carry the lower name up through a rename.
  const lower = await resolveExposedName(parsed.from, table, field, depth - 1, cache);
  if (!lower.name)
    return {
      name: null,
      status: lower.status === "exposed" ? "dropped" : lower.status,
      chain: [...lower.chain, { entity, name: null }],
    };

  const lowerU = lower.name.toUpperCase();
  const fromAliasU = (parsed.fromAlias || "").toUpperCase();
  const fromNameU = (parsed.from || "").toUpperCase();
  const carry = parsed.elements.find(
    (e) =>
      (e.refElem && e.refElem.toUpperCase() === lowerU) ||
      // alias-qualified passthrough of the lower view's element, e.g. `Bank.BankName`
      (e.refField &&
        e.refField.toUpperCase() === lowerU &&
        e.refTable &&
        (e.refTable.toUpperCase() === fromAliasU || e.refTable.toUpperCase() === fromNameU))
  );
  if (carry)
    return {
      name: carry.name,
      status: "exposed",
      chain: [
        ...lower.chain,
        {
          entity,
          name: carry.name,
          renamedFrom: carry.name.toUpperCase() !== lower.name.toUpperCase() ? lower.name : undefined,
        },
      ],
    };
  return {
    name: null,
    status: "dropped",
    chain: [...lower.chain, { entity, name: null, droppedFrom: lower.name }],
  };
}

/** Public wrapper: resolve a DB field's exposure in a released CDS entity. */
async function resolveField(entity, table, field, depth = 3) {
  const cache = new Map();
  const r = await resolveExposedName(entity, table, field, depth, cache);
  const exposed = r.status === "exposed" && !!r.name;
  const trail = [
    `${table}.${field}`,
    ...r.chain.map((c) =>
      c.name
        ? `${c.entity}:${c.name}${c.renamedFrom ? ` (was ${c.renamedFrom})` : ""}`
        : `${c.entity}:${c.droppedFrom ? `not carried (was ${c.droppedFrom})` : "absent"}`
    ),
  ].join(" -> ");
  return {
    input: { entity, table, field, depth },
    exposed,
    exposedName: exposed ? r.name : null,
    status: r.status,
    trail,
    chain: r.chain,
    note: exposed
      ? `Field is exposed in '${entity}' as '${r.name}' — candidate write target (still verify it is not read-only / is released on your stack).`
      : r.status === "dropped"
      ? `Field maps up the stack but is NOT exposed in '${entity}' — no released write path for this field; fall back to a classic (Level B) API.`
      : r.status === "inconclusive_depth"
      ? `Depth ${depth} exhausted before reaching the table — raise depth or inspect manually.`
      : `Could not resolve exposure (${r.status}).`,
  };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "hexa-rapbo-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "check_connection",
    description:
      "Verify connectivity and that the configured credentials are valid, by making one authenticated ADT request. Use this first if lookups fail — it returns the HTTP status so you can tell an expired cookie (401/403) from other errors. Returns no ABAP data.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_rap_bo",
    description:
      "Given a CDS view (an ATC 'successor available' successor, or the underlying CDS the API Hub MCP resolved from an OData API), resolve the on-stack RAP Business Object behind it AND — when 'table' + 'fields' are supplied — map each written DB field to its exposed BO element in the SAME call, then return a consolidated 'fixApproach' (Level A/B, EML write target, mapped vs unmapped fields) the remediation agent turns into code. Walks CDS view → root entity → behavior definition, reports the BO implementation type and create/update/delete, reads the release contract (@VDM.lifecycle.contract.type / @API.state — local on-stack vs remote-only), and follows each field up the CDS stack tracking renames and aliases (e.g. WRKST → BasicMaterial → BasicProduct). Field write-exposure and C1-on-your-release stay developer-verify. Generic across all CDS views. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        cdsView: {
          type: "string",
          description: "CDS view / data definition name to resolve (e.g. A_Product_2 — from the ATC successor or the API Hub's OData→CDS).",
        },
        table: {
          type: "string",
          description: "DB table of the flagged write (e.g. MARA). Pass with 'fields' to get the field→BO-element mappings in the same call.",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Written DB field(s) (e.g. ['WRKST','MEINS']). With 'table', resolves each field's exposed BO element for the EML fix.",
        },
        field: {
          type: "string",
          description: "Single written DB field (convenience alias for fields:[field]).",
        },
      },
      required: ["cdsView"],
      additionalProperties: false,
    },
  },
  {
    name: "odata_to_cds",
    description:
      "Fallback only — the API Hub MCP is the primary OData→CDS resolver; use this on-stack lookup only when the API Hub cannot resolve a service. Resolves an OData service (e.g. API_PRODUCT_SRV) to the CDS entity/entities it exposes, via its RAP service binding → service definition. Classic (SEGW) services have no RAP binding — the tool says so and asks for the CDS successor from the ATC finding instead. Feed the resolved root entity into find_rap_bo. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        odataService: {
          type: "string",
          description: "OData service name (e.g. API_PRODUCT_SRV).",
        },
      },
      required: ["odataService"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_field",
    description:
      "Follow a database table field UP the CDS view stack (generic, not view-family specific) to decide whether a released CDS entity exposes it — tracking element renames at each layer (e.g. wrkst -> BasicMaterial -> BasicProduct). Walks select-from / projection-on down to the table-reading view and carries the element name back up, bounded by depth (default 3). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Released CDS entity to check exposure in (e.g. A_Product_2)." },
        table: { type: "string", description: "DB table of the flagged write (e.g. MARA)." },
        field: { type: "string", description: "DB field written (e.g. WRKST)." },
        depth: { type: "number", description: "Max CDS layers to climb. Defaults to 3." },
      },
      required: ["entity", "table", "field"],
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === "check_connection") {
      const url = withClient("/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=I_Product&maxResults=1");
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/*", ...getAuth(), "User-Agent": "hexa-rapbo-mcp" },
      });
      const ok = res.ok;
      const diag = {
        base: BASE_URL,
        sapClient: SAP_CLIENT,
        tlsInsecure: TLS_INSECURE,
        httpStatus: res.status,
        statusText: res.statusText,
        authValid: ok,
        hint: ok
          ? "Auth is valid and the host is reachable."
          : res.status === 401 || res.status === 403
          ? "Authentication failed — check H1E_USER/H1E_PASSWORD (or refresh the cookie)."
          : "Reachable but non-OK status; check base URL / sap-client.",
      };
      return { content: [{ type: "text", text: JSON.stringify(diag, null, 2) }] };
    }

    if (name === "find_rap_bo") {
      const cdsView = String(args.cdsView || "").trim();
      if (!cdsView) throw new Error("cdsView is required.");
      const table = args.table ? String(args.table).trim() : undefined;
      const fieldsIn = Array.isArray(args.fields) ? args.fields : args.field ? [args.field] : [];
      const fields = fieldsIn.map((f) => String(f).trim()).filter(Boolean);
      const result = await resolveRapBoFromCds(cdsView, fields, table);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "odata_to_cds") {
      const svc = String(args.odataService || "").trim();
      if (!svc) throw new Error("odataService is required.");
      const result = await resolveCdsFromOData(svc);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "resolve_field") {
      const entity = String(args.entity || "").trim();
      const table = String(args.table || "").trim();
      const field = String(args.field || "").trim();
      if (!entity || !table || !field) throw new Error("entity, table and field are required.");
      const depth = args.depth === undefined ? 3 : Number(args.depth);
      const result = await resolveField(entity, table, field, depth);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `hexa-rapbo-mcp error: ${err.message}` }],
    };
  }
});

// ---------------------------------------------------------------------------
// Standalone probe mode (test the resolver without an MCP client):
//   node server.mjs --probe --cds I_Product --field WRKST
//   node server.mjs --probe --odata API_PRODUCT_SRV
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function runProbe(opts) {
  if (opts.odata) {
    const r = await resolveCdsFromOData(String(opts.odata));
    console.log(JSON.stringify(r, null, 2));
  }
  if (opts.cds) {
    const fields = opts.fields
      ? String(opts.fields).split(",").map((f) => f.trim()).filter(Boolean)
      : opts.field
      ? [String(opts.field)]
      : [];
    const r = await resolveRapBoFromCds(String(opts.cds), fields, opts.table ? String(opts.table) : undefined);
    console.log(JSON.stringify(r, null, 2));
  }
  if (opts.entity && opts.table && opts.field) {
    const r = await resolveField(
      String(opts.entity),
      String(opts.table),
      String(opts.field),
      opts.depth ? Number(opts.depth) : 3
    );
    console.log(JSON.stringify(r, null, 2));
  }
  if (!opts.odata && !opts.cds && !(opts.entity && opts.table && opts.field)) {
    console.error(
      "Nothing to probe. Use --cds <NAME> [--field <F>], --odata <SERVICE>, or --entity <E> --table <T> --field <F> [--depth <N>]."
    );
    process.exit(2);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--probe")) {
    try {
      await runProbe(parseArgv(argv));
      process.exit(0);
    } catch (err) {
      console.error(`probe error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `hexa-rapbo-mcp ready · base=${BASE_URL} · client=${SAP_CLIENT} · tlsInsecure=${TLS_INSECURE}`
  );
}

main().catch((err) => {
  console.error("hexa-rapbo-mcp fatal:", err);
  process.exit(1);
});

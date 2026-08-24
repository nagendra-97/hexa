#!/usr/bin/env node
// Hexa ATC detail-fetch MCP server.
//
// Purpose: the standard ATC MCP tools run a check and return finding COUNTS by
// priority, but not the per-finding detail (object, package, location, message)
// the Hexa clean-core assessment needs. This server fills that gap by calling the
// ADT REST worklist endpoint directly with an SSO cookie and returning the
// filtered findings (Priority 1 by default).
//
// Auth: the SSO cookie is read from the environment — never passed as a tool
// argument and never surfaced to the model. Configure it in your MCP client via
// the `env` block (see README) or point H1E_COOKIE_FILE at a git-ignored file.

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
// requested, relax TLS verification for this process only. This process talks to
// exactly one configured host, so the blast radius is limited.
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
  // Header values cannot contain newlines. Flatten a multi-line cookie file into a
  // single valid `name=value; name=value` header.
  const cookie = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("; ")
    .replace(/;\s*;/g, ";")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim();
  if (!cookie) {
    throw new Error("Configured cookie is empty after normalization.");
  }
  return cookie;
}

/**
 * Build the auth header(s). Prefers HTTP Basic (the robust path the ADT server
 * offers via www-authenticate); falls back to a session cookie. Credentials come
 * only from the environment/files — never from a tool argument or the model.
 */
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
    "No credentials configured. Set H1E_USER + H1E_PASSWORD (recommended) or H1E_COOKIE / H1E_COOKIE_FILE in the MCP server env."
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
    headers: {
      Accept: accept,
      ...getAuth(),
      "User-Agent": "hexa-atc-mcp",
    },
  });
  const body = await res.text();
  if (!res.ok) {
    const snippet = body.slice(0, 500);
    throw new Error(
      `ADT GET ${path} → HTTP ${res.status} ${res.statusText}. ${
        res.status === 401 || res.status === 403
          ? "Cookie likely expired — refresh your SSO session and update the cookie. "
          : ""
      }${snippet ? `Response: ${snippet}` : ""}`
    );
  }
  return body;
}

/** Fetch a CSRF token bound to the current session (needed for POST/run). */
async function getCsrf() {
  const res = await fetch(withClient("/sap/bc/adt/atc/customizing"), {
    method: "GET",
    headers: { ...getAuth(), "X-CSRF-Token": "Fetch", Accept: "application/xml", "User-Agent": "hexa-atc-mcp" },
  });
  const token = res.headers.get("x-csrf-token");
  const setCookies = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  if (!token) {
    const body = await res.text();
    throw new Error(`CSRF token fetch failed: HTTP ${res.status}. ${body.slice(0, 200)}`);
  }
  return { token, setCookies };
}

/** Merge any session cookies returned by the token fetch into the auth header. */
function authWithExtraCookies(setCookies) {
  const a = getAuth();
  if (a.Cookie && setCookies && setCookies.length) {
    return { ...a, Cookie: [a.Cookie, ...setCookies].join("; ") };
  }
  return a;
}

async function adtPost(path, { token, setCookies, accept, contentType, body }) {
  const res = await fetch(withClient(path), {
    method: "POST",
    headers: {
      ...authWithExtraCookies(setCookies),
      "X-CSRF-Token": token,
      Accept: accept,
      ...(contentType ? { "Content-Type": contentType } : {}),
      "User-Agent": "hexa-atc-mcp",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ADT POST ${path} → HTTP ${res.status} ${res.statusText}. ${text.slice(0, 300)}`);
  }
  return text;
}

/** Resolve an object name (+optional type) to its ADT URI via quickSearch. */
async function resolveObjectUri(name, type) {
  const t = type ? String(type).replace(/\/.*$/, "") : undefined;
  const qs = new URLSearchParams({ operation: "quickSearch", query: name, maxResults: "50" });
  if (t) qs.set("objectType", t);
  const xml = await adtGet(
    `/sap/bc/adt/repository/informationsystem/search?${qs.toString()}`,
    "application/*"
  );
  const results = parseSearch(xml);
  const exact = results.find(
    (r) =>
      (r.name || "").toUpperCase() === name.toUpperCase() &&
      (!t || (r.type || "").toUpperCase().startsWith(t.toUpperCase()))
  );
  if (!exact) throw new Error(`Object ${name}${type ? ` (${type})` : ""} not found via search.`);
  return exact.uri;
}

// ---------------------------------------------------------------------------
// Worklist parsing
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false,
});

const toArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const attr = (node, name) => (node ? node[`@_${name}`] : undefined);

/** Parse an ADT ATC worklist XML into { meta, findings[] }. */
function parseWorklist(xml) {
  const doc = parser.parse(xml);
  const wl = doc.worklist || doc.worklistRun || {};
  const meta = {
    id: attr(wl, "id"),
    timestamp: attr(wl, "timestamp"),
    usedObjectSet: attr(wl, "usedObjectSet"),
    objectSetIsComplete: attr(wl, "objectSetIsComplete"),
  };

  const findings = [];
  for (const obj of toArray(wl.objects?.object)) {
    const consuming = {
      name: attr(obj, "name"),
      type: attr(obj, "type"),
      package: attr(obj, "packageName"),
      author: attr(obj, "author"),
      objectTypeId: attr(obj, "objectTypeId"),
      uri: attr(obj, "uri"),
    };
    for (const f of toArray(obj.findings?.finding)) {
      const priorityRaw = attr(f, "priority");
      const priority = priorityRaw === undefined ? undefined : Number(priorityRaw);
      const link = f.link ? { href: attr(f, "href") ?? f.link["@_href"], rel: f.link["@_rel"], type: f.link["@_type"] } : undefined;
      findings.push({
        priority,
        consumingObject: consuming,
        checkId: attr(f, "checkId"),
        checkTitle: attr(f, "checkTitle"),
        messageId: attr(f, "messageId"),
        messageTitle: attr(f, "messageTitle"),
        location: attr(f, "location"),
        uri: attr(f, "uri"),
        exemptionApproval: attr(f, "exemptionApproval"),
        exemptionKind: attr(f, "exemptionKind"),
        quickfixInfo: attr(f, "quickfixInfo"),
        link,
      });
    }
  }
  return { meta, findings };
}

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

/** Parse an ATC finding-documentation HTML into referenced object + successors. */
function parseAtcDoc(html) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const grab = (label, stops) => {
    const stop = stops.map(esc).join("|");
    const re = new RegExp(esc(label) + "\\s*(.*?)\\s*(?=" + stop + "|$)", "i");
    const m = text.match(re);
    return m && m[1] ? m[1].trim() : null;
  };
  const AC = "Referenced Application Component:";
  const PK = "Referenced Package:";
  const SC = "Referenced Software Component:";
  const CTX = "Context";
  const referencedObject = grab("Referenced Object:", ["Additional Info:", AC, PK, SC, CTX, "Cannot be suppressed"]);
  const succStr = grab("Successors:", [AC, PK, SC, CTX]);
  const appComponent = grab(AC, [PK, SC, CTX]);
  const referencedPackage = grab(PK, [SC, CTX]);
  const softwareComponent = grab(SC, [CTX]);
  const successors = succStr ? succStr.split(/[,\s]+/).filter(Boolean) : [];
  return { referencedObject, successors, appComponent, package: referencedPackage, softwareComponent };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "hexa-atc-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "atc_get_priority_findings",
    description:
      "Fetch the DETAILED findings of an ATC worklist from the ABAP system over ADT REST, filtered by priority (default Priority 1 only). Use the worklistId returned by the standard ATC run tool. Returns per-finding detail (consuming object, package, code location, checkTitle, messageTitle) that the standard get-result tool does not expose — this is the intake for the Hexa clean-core assessment.",
    inputSchema: {
      type: "object",
      properties: {
        worklistId: {
          type: "string",
          description:
            "The worklistId returned by the ATC run (e.g. from the standard abap_atc_run tool).",
        },
        priority: {
          type: "number",
          description:
            "Only return findings at exactly this ATC priority. Defaults to 1 (Priority 1 / errors). Set to 0 to return all priorities.",
        },
      },
      required: ["worklistId"],
      additionalProperties: false,
    },
  },
  {
    name: "atc_check_connection",
    description:
      "Verify connectivity and that the configured SSO cookie is still valid, by making one authenticated ADT request. Use this first if fetches fail — it returns the HTTP status so you can tell an expired cookie (401/403) from other errors. Returns no ABAP data.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "object_exists",
    description:
      "Check whether an ABAP object exists in the backend via the ADT repository quickSearch API. Give an object name (and optionally a type like FUGR, CLAS, PROG, TABL). Returns whether an exact match exists plus the matched object(s) (name, type, package, uri). Use this as the minimal end-to-end connectivity/auth probe before other ADT calls.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Object name to look up (e.g. ZTQ1). Case-insensitive.",
        },
        type: {
          type: "string",
          description:
            "Optional ADT object type to narrow the search, e.g. FUGR, CLAS, PROG, TABL, DDLS. A '/subtype' suffix (FUGR/F) is accepted and trimmed.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "atc_scan",
    description:
      "Run an ATC check on an object AND return its findings in one self-contained call over HTTP — no separate ATC-run tool needed. Resolves the object's ADT URI, runs the check variant (default ZSMASH_CLEANCORE), then returns the Priority 1 findings grouped into remediation patterns (by message + referenced object). Each pattern includes the referenced object, successors and components (parsed from the ATC documentation), a count, and all code locations. This is the automated intake for the Hexa clean-core assessment.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Object name to check, e.g. ZTQ1." },
        type: {
          type: "string",
          description: "ADT object type, e.g. FUGR, CLAS, PROG, TABL. A '/subtype' suffix (FUGR/F) is accepted.",
        },
        checkVariant: {
          type: "string",
          description: "ATC check variant. Defaults to ZSMASH_CLEANCORE.",
        },
        priority: {
          type: "number",
          description: "Only return findings at this priority. Defaults to 1 (errors). Set 0 for all.",
        },
        includeSuccessors: {
          type: "boolean",
          description: "Enrich each finding with referenced object, successors, and components parsed from the ATC finding documentation. Defaults to true.",
        },
        objectUri: {
          type: "string",
          description: "Optional explicit ADT URI to bypass name/type resolution.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === "atc_get_priority_findings") {
      const worklistId = String(args.worklistId || "").trim();
      if (!worklistId) throw new Error("worklistId is required.");
      const priority = args.priority === undefined ? 1 : Number(args.priority);

      const xml = await adtGet(
        `/sap/bc/adt/atc/worklists/${encodeURIComponent(
          worklistId
        )}?includeExemptedFindings=false`,
        "application/atc.worklist.v1+xml"
      );
      const { meta, findings } = parseWorklist(xml);
      const selected =
        priority === 0 ? findings : findings.filter((f) => f.priority === priority);

      const byMessage = {};
      for (const f of selected) {
        const key = f.messageTitle || "(no message title)";
        byMessage[key] = (byMessage[key] || 0) + 1;
      }

      const result = {
        worklistId,
        base: BASE_URL,
        sapClient: SAP_CLIENT,
        priorityFilter: priority === 0 ? "all" : priority,
        totalFindingsInWorklist: findings.length,
        matchedFindings: selected.length,
        findingsByMessageTitle: byMessage,
        meta,
        findings: selected,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "atc_check_connection") {
      const url = withClient("/sap/bc/adt/atc/customizing");
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/xml, application/vnd.sap.atc.customizing-v1+xml",
          ...getAuth(),
          "User-Agent": "hexa-atc-mcp",
        },
      });
      const ok = res.ok;
      const diag = {
        base: BASE_URL,
        sapClient: SAP_CLIENT,
        tlsInsecure: TLS_INSECURE,
        httpStatus: res.status,
        statusText: res.statusText,
        cookieValid: ok,
        hint: ok
          ? "Auth is valid and the host is reachable."
          : res.status === 401 || res.status === 403
          ? "Authentication failed — check H1E_USER/H1E_PASSWORD (or refresh the cookie)."
          : "Reachable but non-OK status; check base URL / sap-client.",
      };
      return { content: [{ type: "text", text: JSON.stringify(diag, null, 2) }] };
    }

    if (name === "object_exists") {
      const objName = String(args.name || "").trim();
      if (!objName) throw new Error("name is required.");
      const objType = args.type ? String(args.type).trim().replace(/\/.*$/, "") : undefined;

      const qs = new URLSearchParams({
        operation: "quickSearch",
        query: objName,
        maxResults: "50",
      });
      if (objType) qs.set("objectType", objType);

      const xml = await adtGet(
        `/sap/bc/adt/repository/informationsystem/search?${qs.toString()}`,
        "application/*"
      );
      const results = parseSearch(xml);
      const exact = results.filter(
        (r) =>
          (r.name || "").toUpperCase() === objName.toUpperCase() &&
          (!objType || (r.type || "").toUpperCase().startsWith(objType.toUpperCase()))
      );

      const result = {
        base: BASE_URL,
        sapClient: SAP_CLIENT,
        query: objName,
        type: objType ?? "any",
        exists: exact.length > 0,
        exactMatches: exact,
        totalResults: results.length,
        results: results.slice(0, 20),
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "atc_scan") {
      const objName = String(args.name || "").trim();
      if (!objName) throw new Error("name is required.");
      const type = args.type ? String(args.type).trim() : undefined;
      const checkVariant =
        (args.checkVariant && String(args.checkVariant).trim()) || "ZSMASH_CLEANCORE";
      const priority = args.priority === undefined ? 1 : Number(args.priority);
      const uri =
        (args.objectUri && String(args.objectUri).trim()) ||
        (await resolveObjectUri(objName, type));

      const { token, setCookies } = await getCsrf();

      // 1) Create/select the check-variant worklist.
      const worklistId = (
        await adtPost(
          `/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(checkVariant)}`,
          { token, setCookies, accept: "text/plain" }
        )
      ).trim();

      // 2) Trigger the run for the object.
      const runBody =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<atc:run maximumVerdicts="100" xmlns:atc="http://www.sap.com/adt/atc">\n` +
        `  <objectSets xmlns:adtcore="http://www.sap.com/adt/core">\n` +
        `    <objectSet kind="inclusive">\n` +
        `      <adtcore:objectReferences>\n` +
        `        <adtcore:objectReference adtcore:uri="${uri}"/>\n` +
        `      </adtcore:objectReferences>\n` +
        `    </objectSet>\n` +
        `  </objectSets>\n` +
        `</atc:run>`;
      await adtPost(`/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}`, {
        token,
        setCookies,
        accept: "application/xml",
        contentType: "application/xml",
        body: runBody,
      });

      // 3) Fetch the worklist detail (retry briefly if findings not yet populated).
      let parsed;
      for (let attempt = 0; attempt < 4; attempt++) {
        const xml = await adtGet(
          `/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}?includeExemptedFindings=false`,
          "application/atc.worklist.v1+xml"
        );
        parsed = parseWorklist(xml);
        if (parsed.findings.length > 0 || attempt === 3) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      const { findings } = parsed;
      const selected =
        priority === 0 ? findings : findings.filter((f) => f.priority === priority);

      const byMessage = {};
      for (const f of selected) {
        const key = f.messageTitle || "(no message title)";
        byMessage[key] = (byMessage[key] || 0) + 1;
      }

      // Compact payload: only what the assessment consumes, to keep tokens tight.
      const o0 = selected[0]?.consumingObject || {};
      const includeExtra = args.includeSuccessors !== false;

      // Enrich each finding with successor detail from its ATC documentation.
      const enriched = await Promise.all(
        selected.map(async (f) => {
          let extra = null;
          if (includeExtra && f.link?.href) {
            try {
              const html = await adtGet(
                f.link.href,
                "application/vnd.sap.adt.docu.v1+html, text/html"
              );
              extra = parseAtcDoc(html);
            } catch {
              extra = null;
            }
          }
          return { ...f, extra };
        })
      );

      // Group into remediation patterns (message + referenced object): the shared
      // successor detail appears once per pattern, with all its locations listed.
      const groups = new Map();
      for (const f of enriched) {
        const table = f.extra?.referencedObject ?? null;
        const key = `${f.messageId}|${table ?? ""}`;
        if (!groups.has(key)) {
          groups.set(key, {
            priority: f.priority,
            messageId: f.messageId,
            messageTitle: f.messageTitle,
            referencedObject: table,
            successors: f.extra?.successors ?? [],
            appComponent: f.extra?.appComponent ?? null,
            package: f.extra?.package ?? null,
            softwareComponent: f.extra?.softwareComponent ?? null,
            docUri: f.link?.href ?? null,
            count: 0,
            locations: [],
          });
        }
        const p = groups.get(key);
        p.count += 1;
        p.locations.push(f.location);
      }
      const patterns = [...groups.values()];

      const result = {
        object: { name: objName, type: type ?? o0.type ?? null, package: o0.package ?? null, uri },
        checkVariant,
        worklistId,
        priorityFilter: priority === 0 ? "all" : priority,
        matched: selected.length,
        patternCount: patterns.length,
        byMessageTitle: byMessage,
        patterns,
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `hexa-atc-mcp error: ${err.message}` }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is reserved for the MCP protocol.
  console.error(
    `hexa-atc-mcp ready · base=${BASE_URL} · client=${SAP_CLIENT} · tlsInsecure=${TLS_INSECURE}`
  );
}

main().catch((err) => {
  console.error("hexa-atc-mcp fatal:", err);
  process.exit(1);
});

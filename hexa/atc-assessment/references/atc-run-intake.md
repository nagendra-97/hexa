# Intake module — Automated ATC run (ZSMASH_CLEANCORE) via MCP

> **STATUS: ACTIVE.** Alternative to manual paste. Produces the same finding intake
> the assessment consumes, but sourced from a live ATC run instead of copy/paste.

Use this module when the developer wants Hexa to **run the clean-core check itself**
rather than pasting findings. It runs the `ZSMASH_CLEANCORE` check variant against a
developer-selected object list on the H1E system, retrieves **only Priority 1**
findings, and hands them to the shared assessment workflow in
[../SKILL.md](../SKILL.md). Classification, overrides, and the report are unchanged —
this module only replaces **how the findings arrive**.

## Tool it uses

| Tool | Role |
|------|------|
| `atc_scan` (hexa-atc MCP) | **One call**: resolves the object's ADT URI, runs the check variant (default `ZSMASH_CLEANCORE`), and returns the detailed **Priority 1** findings. Self-contained over HTTP with the session cookie — no separate run/poll tool, no `mcp_adt`. |
| `atc_check_connection` (hexa-atc MCP) | Only if `atc_scan` errors with 401/403 — distinguishes an expired session cookie from other errors. |

The `hexa-atc` server must be registered and its `SAP_SESSIONID_H1E_104` cookie
configured — see [../../atc-mcp/README.md](../../atc-mcp/README.md). **Never ask the
developer to paste the cookie into chat**; it is read from the server's environment
only. If it is not configured, stop and point them at that README. (Legacy path: the
standard `abap_atc_run` + `abap_atc_get_result` then `atc_get_priority_findings` still
works if you already hold a `worklistId`, but `atc_scan` replaces all three.)

## Flow

### Step A — Choose the object(s)

The developer names the object(s) to check. If none is named, ask which one before
doing anything else. For each object collect `name` and, when helpful, `type` (e.g.
`ZTQ1`, `FUGR`). The **run** targets the named object; the finer read scope (which
members of a container to read) is confirmed in Step C.

### Step B — Run + fetch in one call

Call `atc_scan` with:

- `name`: the object name (e.g. `ZTQ1`),
- `type` *(optional)*: ADT type to disambiguate (e.g. `FUGR`, `CLAS`, `PROG`),
- `checkVariant` *(optional)*: defaults to `ZSMASH_CLEANCORE`,
- `priority` *(optional)*: defaults to **1**.

It returns a compact payload: a top-level `object` (name · type · package · uri), the
`worklistId`, `matched` (raw Priority 1 count), `patternCount`, a `byMessageTitle`
summary, and `patterns[]`. Findings are **grouped into remediation patterns** by
message + referenced object, so the successor detail appears once per pattern. Each
pattern carries `priority`, `messageId`, `messageTitle`, `referencedObject`
(e.g. `MARA (TABL)`), `successors` (e.g. `I_PRODUCT`, …), `appComponent`, `package`,
`softwareComponent`, `count`, and `locations[]` (every include/line site). Run it once
per object if several were named.

- If it errors with 401/403, call `atc_check_connection`; if the cookie is invalid,
  tell the developer to refresh their SSO session and update `cookie.txt`, then retry.

### Step C — Map to the assessment intake, then assess

Each `atc_scan` **pattern** already is the report's unit of work (one Findings-detail
row). Map fields:

| Assessment field | From `atc_scan` pattern |
|------------------|-------------------------|
| Object · type · package | top-level `object` |
| Message title | `messageTitle` |
| Referenced table | `referencedObject` |
| Successors · software component | `successors` · `softwareComponent` |
| Location(s) | `locations[]` (count = `count`) |

Then **scope by message title exactly as the dispatch table in [../SKILL.md](../SKILL.md)
requires** — route each finding to its finding module (DDIC-write, object-modified,
PERFORM-not-allowed). Any Priority 1 finding whose message title is not in the dispatch
table is **out of scope**; list it but do not assess it. From here the run is identical
to the manual path: **read the selected source fresh → classify → apply overrides →
compile records → render the report**. The `worklistId`, `ZSMASH_CLEANCORE` variant,
and fetch date belong in the report's provenance footer.

## Boundaries

- This module runs the ATC check and **retrieves** findings; it never applies
  quickfixes or AI fixes and never writes to the system (an ATC run is read-only
  analysis). Assessment stays read-only.
- Priority is fixed to **1** by design (the developer asked for Priority 1 only). Do not
  widen it unless the developer explicitly requests other priorities.
- The referenced SAP table and its successors come from the ATC finding itself
  (each pattern's `referencedObject` / `successors`); the **write verb and written
  fields** are still confirmed by reading the source at the pattern's `locations`, per
  the shared read-source step. The finding seeds the table, successors, and locations;
  the code decides the verdict.

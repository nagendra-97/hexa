# hexa-rapbo-mcp

A small, **read-only** MCP server that answers one question for clean-core
remediation:

> The ATC finding says a **successor is available** (often a *read-only* CDS view).
> Is there a real **on-stack RAP Business Object** behind it that I can write to via
> EML — or is it genuinely OData/side-by-side only?

It turns a dead-end ("it's just an OData service, you can't use it on-stack") into an
actionable lead by walking the metadata links over ADT REST:

```
OData service → service binding → service definition → exposed CDS entity
CDS view (successor) → root entity → behavior definition (the RAP BO)
```

It **never writes** to the backend — every call is a GET. It resolves/assesses only;
generating and applying the fix stays with the developer.

## Why it exists

`atc-remediation` grades a DDIC-write target as **Level A** (released, on-stack RAP
BO via `MODIFY ENTITIES`) or **Level B** (classic BAPI). The API Hub tells you an
`API_*_SRV` exists, but an OData/A2X service is **side-by-side only** — not callable
for write from on-stack ABAP. The missing step is: *does a released RAP BO sit behind
that service / CDS view on this system?* This server does that lookup so the fix can
name the real on-stack write path instead of shrugging at "OData only".

## Tools

| Tool | Input | Returns |
|------|-------|---------|
| `check_connection` | — | Auth/host status (401/403 vs. other), no ABAP data. |
| `find_rap_bo` | `cdsView`, optional `field` | Whether a behavior definition (RAP BO) exists behind the CDS view, its implementation type (`managed`/`unmanaged`/`projection`/`abstract`), whether it exposes `create/update/delete` (a Level A write target), and best-effort whether `field` is referenced. |
| `odata_to_cds` | `odataService` | The CDS entity(ies) the service exposes, via its RAP service binding → service definition. Says so when it's a classic (SEGW) service with no RAP binding. |

Typical chain: `odata_to_cds(API_…_SRV)` → take the root entity → `find_rap_bo(entity, field)`.
For an ATC finding you can usually skip the first step and pass the finding's CDS
**successor** straight into `find_rap_bo`.

### Verdicts (`find_rap_bo`)

- `onstack_bo_writable` — a BDEF with create/update/delete exists → **candidate Level A**
  (verify released + field exposure).
- `bo_found_not_writable` — BDEF exists but no write ops detected → verify.
- `no_onstack_bo` — no BDEF → OData is side-by-side only; fall back to **Level B** classic on-stack.
- `cds_not_found` — the CDS view name didn't resolve.

> **Not verified here:** released-on-your-stack (C1 contract) and field write-exposure.
> Those stay developer-verify — the server gives the lead, not a guarantee.

## Configure (auth from environment only)

Reuses the **same env contract as `hexa-atc-mcp`**, so you can point it at the same
cookie file. Prefer HTTP Basic; cookie is the fallback. Credentials are read from env
only — never a tool argument, never surfaced to the model.

| Env | Meaning |
|-----|---------|
| `H1E_BASE_URL` | ABAP host base URL (default the H1E host). |
| `H1E_CLIENT` | SAP client (default `104`). |
| `H1E_TLS_INSECURE` | `true` to relax TLS for this process (internal self-signed hosts). |
| `H1E_USER` + `H1E_PASSWORD` / `H1E_PASSWORD_FILE` | HTTP Basic (recommended). |
| `H1E_COOKIE` / `H1E_COOKIE_FILE` | SSO cookie (fallback). |

See `mcp.example.jsonc` for a client registration block.

## Install

```powershell
cd hexa/rapbo-mcp
npm install
```

## Test it standalone (no MCP client)

The server has a `--probe` mode so you can validate the resolver directly against the
backend before wiring it into any client or skill:

```powershell
# point it at an existing cookie (or set H1E_USER/H1E_PASSWORD)
$env:H1E_COOKIE_FILE = "$PWD/../atc-mcp/cookie.txt"

# resolve a CDS successor to its RAP BO, checking a field
node server.mjs --probe --cds I_Product --field WRKST

# resolve an OData service to its CDS entities
node server.mjs --probe --odata API_PRODUCT_SRV
```

Each prints the same JSON the MCP tool returns.

## Status

Experimental — built to be tested standalone first. Once validated it can be wired
into `atc-remediation` as the successor-available lookup (OData/CDS → on-stack RAP BO)
so the remediation draft names the real Level A write path.

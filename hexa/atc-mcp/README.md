# hexa-atc-mcp — ATC detail-fetch MCP server

A tiny local MCP server that returns the **detailed findings** of an ATC worklist
(Priority 1 by default) from the H1E ABAP system over ADT REST.

## Why it exists

The standard ATC MCP tools do the run and tell you *how many* findings there are per
priority — but not *which* findings, on which objects, at which lines. The Hexa
clean-core assessment needs that per-finding detail. This server fills exactly that
gap by calling `GET /sap/bc/adt/atc/worklists/{worklistId}` and parsing it.

It does **not** run ATC — that stays with the standard `abap_atc_run` tool. This
server only reads the resulting worklist.

## Tools

- `atc_scan(name, type?, checkVariant?, priority?)` — **one call**: resolve the object's
  ADT URI, run the check variant (default `ZSMASH_CLEANCORE`), and return the detailed
  findings (default Priority 1). Self-contained — no separate ATC-run tool. This is the
  automated intake for the assessment.
- `atc_get_priority_findings(worklistId, priority=1)` — fetch findings of an existing
  worklist, filtered to a priority. Pass `priority: 0` for all.
- `object_exists(name, type?)` — check whether an ABAP object exists via the ADT
  repository quickSearch. Minimal end-to-end connectivity/auth probe.
- `atc_check_connection()` — one authenticated request to verify the cookie/host.
  Use it to distinguish an expired cookie (401/403) from other errors.

## Setup

1. Install dependencies (one time):

   ```powershell
   cd hexa/atc-mcp
   npm install
   ```

2. Register the server. Copy the block from `mcp.example.jsonc` into
   `<repo-root>/.vscode/mcp.json` (create the file if it does not exist).

3. Provide the H1E **session cookie** **without pasting it into chat**: save it into
   `hexa/atc-mcp/cookie.txt` (already git-ignored) as a single line:

   ```
   SAP_SESSIONID_H1E_104=<value>
   ```

   Get it by opening this URL in your browser to authenticate via SSO, then read its
   cookies:
   `https://azlsaph1eas01.int.pg.com:8443/sap/opu/odata/sap/adt_srv/?sap-client=104`
   — DevTools (F12) → Application → Cookies → select the site → copy
   `SAP_SESSIONID_H1E_104`. It expires with your session; refresh it when
   `atc_check_connection` reports 401/403.

   > **Use the session cookie, not `MYSAPSSO2`.** On this landscape the browser's
   > `MYSAPSSO2` ticket is issued by another system (H1D) and H1E rejects it
   > ("Anmeldung fehlgeschlagen"). The stateful `SAP_SESSIONID_H1E_104` is what H1E
   > accepts. Basic auth (username/password) is not used — this is an SSO landscape.

## Configuration (env)

| Variable | Default | Purpose |
|----------|---------|---------|
| `H1E_BASE_URL` | `https://azlsaph1eas01.int.pg.com:8443` | System host:port |
| `H1E_CLIENT` | `104` | `sap-client` |
| `H1E_TLS_INSECURE` | `true` | Relax TLS verification for the private-CA host |
| `H1E_COOKIE` | — | Cookie string (use `SAP_SESSIONID_H1E_104=…`) |
| `H1E_COOKIE_FILE` | — | Path to a git-ignored file holding the cookie |

## Security notes

- The cookie is read only from the environment/file — never a tool argument, never
  returned to the model.
- `cookie.txt`, `.env`, and `*.cookie` are git-ignored. Do not commit secrets.
- `H1E_TLS_INSECURE=true` disables certificate verification for this process. It only
  ever talks to the one configured host; set it to `false` if the host has a trusted
  certificate.

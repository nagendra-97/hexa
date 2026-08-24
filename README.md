# Hexa — Clean Core DDIC-Write Assessment for GitHub Copilot

Adds a `/hexa-assess` slash command to GitHub Copilot Chat that assesses SAP
clean-core ATC "Usage of APIs" findings where custom ABAP writes to an SAP DDIC
table/view, and generates a **Clean Core Assessment** HTML report. It **assesses and
categorizes only** — it does not produce remediated ABAP.

## Prerequisites

- **VS Code** with **GitHub Copilot Chat** (Agent mode) and MCP support.
- **Node.js ≥ 18** (runs the local `hexa-atc` MCP server).
- Access to **H1E** ADT over HTTPS and a valid **`SAP_SESSIONID_H1E_104`** session
  cookie (step 3 below).

## Quick start (automated — recommended)

1. **Clone** this repo and open it in VS Code.
2. **Install the MCP server dependencies:**
   ```powershell
   cd hexa/atc-mcp
   npm install
   ```
3. **Add your H1E cookie:** create `hexa/atc-mcp/cookie.txt` (git-ignored) containing one
   line — `SAP_SESSIONID_H1E_104=<value>` — copied from an authenticated browser session
   to `https://azlsaph1eas01.int.pg.com:8443` (DevTools → Application → Cookies → select
   the site → copy `SAP_SESSIONID_H1E_104`). Details in
   [hexa/atc-mcp/README.md](hexa/atc-mcp/README.md).
4. **Start the server:** the ready-made `.vscode/mcp.json` registers `hexa-atc` for you —
   Command Palette → **“MCP: List Servers”** → `hexa-atc` → **Start** (or reload the window).
5. **Verify:** run the `atc_check_connection` tool → expect `cookieValid: true`.
6. **Assess:** open Copilot Chat in **Agent** mode, type `/hexa-assess`, and name an object
   (e.g. `ZTQ1`). Hexa runs `ZSMASH_CLEANCORE`, pulls the **Priority 1** findings, reads the
   flagged source, and writes `hexa-assessment-<date>.html` at the repo root.

The cookie expires with your session — refresh `cookie.txt` when `atc_check_connection`
reports 401/403.

### Fallback: paste findings

Prefer not to run it live? Type `/hexa-assess` and **paste** an ATC `Check Title /
Message Title` table or full finding rows; Hexa assesses those instead. No MCP server or
cookie needed for the paste path.

## What's included

```
<repo-root>/
├─ .vscode/
│  └─ mcp.json                           ← registers the hexa-atc MCP server (H1E, no secret)
├─ .github/
│  └─ prompts/
│     └─ hexa-assess.prompt.md           ← the /hexa-assess command
└─ hexa/
   ├─ atc-assessment/
   │  ├─ SKILL.md                        ← assessment logic (two-branch routing, gates)
   │  ├─ references/report-format.md     ← exact report layout spec
   │  ├─ references/atc-run-intake.md    ← automated intake (atc_scan) flow
   │  └─ assets/report-template.html     ← styled HTML report template
   └─ atc-mcp/                           ← local MCP server (run + fetch Priority 1)
      ├─ server.mjs
      ├─ cookie.txt                       ← YOU create this (git-ignored); holds your cookie
      └─ README.md
```

Installing into an existing repo instead of cloning? Copy `.github/`, `.vscode/`, and
`hexa/` into your repo root, keeping these paths. If you move `hexa/`, update the paths
inside `.github/prompts/hexa-assess.prompt.md`.

## Notes

- **Agent mode is required** so Copilot can read files and write the report. If your
  VS Code build ignores `mode: agent` in the prompt frontmatter, change that line to
  `agent: 'agent'` (a recent rename).
- **Scope**: only the two DDIC-write messages —
  `Updating DDIC database tables or DDIC table views is not allowed` and the
  `(successor available)` variant. Other finding types are marked out of scope.
- The command does **not** re-run ATC or query the Cloudification Repository during
  assessment; the finding already carries the successor verdict. The **optional**
  automated intake is the one exception — it runs ATC *once* up front only to obtain the
  findings, then assessment proceeds read-only.

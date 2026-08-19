# Hexa — Clean Core DDIC-Write Assessment for GitHub Copilot

Adds a `/hexa-assess` slash command to GitHub Copilot Chat that assesses SAP
clean-core ATC "Usage of APIs" findings where custom ABAP writes to an SAP DDIC
table/view, and generates a **Clean Core Assessment** HTML report. It **assesses and
categorizes only** — it does not produce remediated ABAP.

## Install

Copy both top-level folders into the **root of your repository**, keeping the paths:

```
<repo-root>/
├─ .github/
│  └─ prompts/
│     └─ hexa-assess.prompt.md          ← the /hexa-assess command
└─ hexa/
   └─ atc-assessment/
      ├─ SKILL.md                        ← assessment logic (two-branch routing, gates)
      ├─ references/report-format.md     ← exact report layout spec
      └─ assets/report-template.html     ← styled HTML report template
```

The command references the `hexa/atc-assessment/…` paths. If you place the
`hexa/` folder elsewhere, update those three paths inside
`.github/prompts/hexa-assess.prompt.md`.

## Use

1. Open the repo in **VS Code** and open **Copilot Chat** in **Agent** mode.
2. Type `/hexa-assess`, paste your ATC findings after it (a `Check Title / Message
   Title` table or full finding rows), and optionally add the target S/4 release.
3. Copilot reads the skill, reads the referenced ABAP source from your workspace,
   and writes `hexa-assessment-<date>.html` at the repo root.

Once saved, the command is indexed automatically and appears when you type `/` in
chat. Anyone who clones the repo gets it too.

## Notes

- **Agent mode is required** so Copilot can read files and write the report. If your
  VS Code build ignores `mode: agent` in the prompt frontmatter, change that line to
  `agent: 'agent'` (a recent rename).
- **Scope**: only the two DDIC-write messages —
  `Updating DDIC database tables or DDIC table views is not allowed` and the
  `(successor available)` variant. Other finding types are marked out of scope.
- The command does **not** re-run ATC or query the Cloudification Repository; the
  finding already carries the successor verdict.

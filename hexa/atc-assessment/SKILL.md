---
name: atc-ddic-write-assessment
description: >-
  Assess (do not fix) SAP clean-core ATC findings from the "Usage of APIs" check
  where custom code writes to an SAP DDIC database table or table view, and route
  each finding into a remediation-effort bucket (AI fix / AI + Dev / Redesign /
  Assessment inconclusive). Use this whenever an ATC finding has the message title
  "Updating DDIC database tables or DDIC table views is not allowed" OR
  "Updating DDIC database tables or DDIC table views is not allowed (successor
  available)" — including when the user pastes a findings table, a single finding
  row, or asks how to assess / categorize / triage a DDIC-write or "updating
  standard table" finding. Trigger even if the user does not name the buckets or
  say "clean core" explicitly; a DDIC-write finding is enough. This skill assesses
  and categorizes only — it does not produce remediated ABAP code.
---

# ATC DDIC-Write Assessment

## What this skill is for

This skill assesses SAP clean-core ATC findings and assigns each one a
remediation-effort category. It is an **assessment** activity: the goal is to
understand each finding and route it, **not** to write the corrected code. Fixing
is a later phase.

The findings it covers — and where each finding's specific logic lives — are listed
in the dispatch table below. Today the DDIC-write and object-modified findings are
active.

## Finding modules (dispatch)

The four buckets, the assessment workflow, and the report below are shared across
**all** clean-core ATC findings. The finding-specific logic (how to parse, read,
classify, and route each message) lives in a per-finding module. Match the
finding's **message title** to its module and follow that module together with the
shared workflow.

| Check title | Message title | Module | Status |
|-------------|---------------|--------|--------|
| Usage of APIs | Updating DDIC database tables or DDIC table views is not allowed *(± successor available)* | [references/ddic-write.md](references/ddic-write.md) | **Active** |
| Usage of APIs | PERFORM program is not allowed | [references/perform-not-allowed.md](references/perform-not-allowed.md) | **Active** |
| Allowed Enhancement Technologies | Enhancement technology not allowed | [references/enhancement-technology.md](references/enhancement-technology.md) | Skeleton — not yet active |
| Detect customer modifications | Object is modified | [references/object-modified.md](references/object-modified.md) | **Active** |

The DDIC-write, object-modified, and PERFORM-not-allowed modules are authored and
active. The remaining module (enhancement-technology) is a **skeleton** — do not use
it for assessment until it is filled in and marked active here.

## Intake (how findings arrive)

Findings reach the workflow one of two ways; both produce the same finding rows that
feed Step 1 onward:

- **Automated ATC run** *(default)* — the developer names the object(s) to check and
  Hexa runs the `ZSMASH_CLEANCORE` check variant on H1E and retrieves only Priority 1
  findings, so nothing is pasted. Follow
  [references/atc-run-intake.md](references/atc-run-intake.md): a single `atc_scan`
  call on the `hexa-atc` server resolves the object URI, runs the variant, and returns
  the detailed Priority 1 rows — no `mcp_adt` needed. It then maps the result into the
  same intake. The session cookie is read from the `hexa-atc` server's environment —
  never pasted into chat.
- **Manual paste** *(fallback)* — the developer pastes a `Check Title / Message Title`
  table or full finding rows instead of a live run.

Either way, once the finding rows exist, continue with the shared workflow below.

## The four effort buckets

Route every finding to exactly one:

- **AI fix** — deterministic and low-context. The correct replacement is knowable
  from the code and the finding alone, with no business-logic judgment and no
  transactional side effects to validate. An assistant could produce the final
  change unattended. In practice this is rarely reachable; each finding module
  states when (if ever) it applies.
- **AI + Dev** — an assistant can draft the remediation, but a developer must
  validate business/transactional semantics (commit, locking, authorizations,
  field behavior) and test before it ships.
- **Redesign** — no like-for-like target exists. The object needs architectural
  rework: a different data model, a move out of code into configuration, or
  reliance on an owning process that writes the data itself.
- **Assessment inconclusive** *(the base/default)* — not enough information to
  route confidently. Anything that does not clearly land in the other three lands
  here, usually with a provisional route noted and a statement of what is missing.

## Assessment workflow

Follow these steps in order for each finding.

### Step 1 — Parse the finding

Extract, from the finding row/text:

- **Consuming object** — the custom object that contains the violation
  (e.g. `ZSUSLOCK`, type `PROG`). This is where the source lives.
- **Referenced object** — the SAP object the finding points at (table/view,
  program, enhancement spot, or modified object), plus its package, software
  component, and application component if given. These identify the owning area.
- **Finding-specific attributes** — read any per-message attributes the matched
  module calls for (e.g. successor present/not, and confirming the write verb, for
  DDIC-write). See the module named in the dispatch table.

These clean-core findings are typically non-suppressible (no pragma /
pseudo-comment), so the only valid outcomes are genuine remediation or a formal
ATC exemption — never silencing it.

### Step 2 — Read the source in the workspace

The finding names the object and table but not the logic. **Before classifying,
read the referenced object's code from the open VS Code workspace.** This is what
turns a guess into an assessment, and it is the difference between a real bucket
and "Assessment inconclusive."

**Enumerate the finding's objects and let the developer pick the scope before you
assess.** In VS Code connected to an S/4 system over ADT, a finding often names a
**container** (e.g. a function group) whose flagged statements are spread across
several includes or function modules. Do **not** limit yourself to the active tab or
even the currently open tabs — **enumerate the container's member objects from the
ADT virtual filesystem** (list the object's folder, e.g. the function group's
`…/Function Groups/<FUGR>/` directory, to discover every function module / include /
TOP include, whether or not a tab is open). Then **present those objects to the
developer as a selectable list of options and let them choose which are relevant** —
do not decide the scope yourself. Recommend the likely ones (the members that
contain the flagged write and its shared declarations), but the developer's
selection is authoritative. **Read every selected object** (following the call chain
into includes), then search the workspace for any referenced routines the selection
doesn't cover. **Start assessing only after the developer has made the selection** —
an incomplete set silently drops write sites and undercounts the findings.

**Read the source fresh after the selection, before you classify.** Once the
developer has chosen the objects, open and read each selected object's code *now* —
do not rely on an earlier read or assume its contents. The sequence is strict: paste
findings → present objects → developer selects → **read the selected source** →
assess the findings against that code → render the report. Only what you read here
drives the classification.

Open the consuming object and read the routine containing the flagged write, then
follow what matters:

- the enclosing method/form/block and how the write is reached (single record vs.
  loop / mass operation; guarded by a condition or unconditional);
- where the **written values and keys** come from (selection screen, another
  table, a calculation);
- surrounding `SELECT` / lock / `COMMIT` logic and existing error handling;
- includes, called subroutines/methods, and local classes the write depends on.

**Follow the call chain, not just the named object.** The write may sit in an
include or a called routine rather than the main program body — trace it from the
flagged line rather than assuming the statement lives in the object named by the
finding.

**ABAP / S4 over ADT — objects may be virtual documents.** When the workspace is
connected to an S/4HANA system through ADT, opened objects are read-only *virtual*
editor documents, not files on disk — on-disk workspace search will not find them.
Read the **open editor tabs and attached context** as the source, and treat DDIC
artifacts accordingly (e.g. CDS views with **virtual/calculated elements**,
`@ObjectModel`/`@Semantics` annotations, table `.abap` sources). Do not mark a
finding "source unavailable" just because file search missed it — check what is
open first.

**Precedence:** source read from the workspace (or an open ADT document) outranks
any inference from the table name. If the code contradicts what the table's role
suggested, the code wins. Only when the object genuinely cannot be found or read —
or a needed include is neither open nor in the workspace — does that gap feed
"Assessment inconclusive (source unavailable)"; note the unread dependency in the
record rather than treating its absence as intent.

**No hard-coded objects.** Every assessment is driven per-run by three inputs only:
(a) the ATC finding data, (b) the source read fresh for this run, and (c) your own
reasoning to propose the candidate write API/behavior. Never cache or hard-code
per-table verdicts (e.g. "table X → API Y") or per-object shapes (e.g. "object Z has
N writes") as reusable routing facts, and never let a prior run's conclusion stand in
for reading this run's code. Any specific table, successor, or API named in this skill
or its references is an **illustrative example only, never a rule** — derive the real
target from the finding and the code in front of you.

Reading the code resolves the four things the finding omits: the **verb and
fields written**, the **intent**, the **feasibility** of an API mapping, and the
**sensitivity in context**.

### Step 3 — Classify and route (per-finding module)

Classification and bucket routing are finding-specific. Follow the module matched
in the dispatch table: it defines the finding's classification dimension and its
rules for routing into the four buckets. Return here for the shared overrides and
reporting.

### Step 4 — Apply shared overrides

These apply on top of any module's routing:

- **Sensitivity.** Security, user/authentication, or financial objects force a
  **mandatory human/security review** regardless of the computed bucket; they
  never route to an unattended fix. Flag this explicitly in the record.
- **Missing source or ambiguous intent** → **Assessment inconclusive (source
  required/unavailable)**, with the provisional route noted.

### Step 5 — Compile the record, then render the report

Per finding, capture: object · type · package · lines · source-read? · referenced
table + role · **operation (verb) + fields written** · **code location
(include/method/line)** · successor + kind · derived write API/behavior · write-path
feasibility · confidence · sensitivity · bucket · next step.

Then derive the report-level facts that make the report useful rather than just a
count:

- **Group into distinct remediation patterns.** Identical writes (same operation +
  table + field set + fix) are *one* pattern applied in N places — one thing to
  solve, not N. Report both raw findings and pattern count; the pattern is the unit
  of real work.
- **Size each pattern** (indicative S/M/L — see the reference) and roll up to a
  coarse effort estimate. Always mark it "after verification"; never let effort read
  as ready-to-run.
- **Derive prerequisites** — the few things that must be true before any code is
  generated (the written field's write-exposure on the target release, released API
  availability; for redesign/inconclusive, the decision to be made and its owner).
  At assessment time their status is **Open** and the **verified count is 0** —
  nothing is proven on the customer's stack yet. This is the honesty guardrail: an
  "AI-remediable" figure is a *potential*, not a done fix.
- **Flag risk** on findings touching security / user / financial tables.

Then render the **Clean Core Assessment report** as HTML using
`assets/report-template.html`, following `references/report-format.md` exactly. Read
`references/report-format.md`, `assets/report-template.html`, and any existing dated
report file in one batch before rendering — they are independent, so read them
together rather than one at a time. The report is one page for two readers: a concise
**management summary** (readiness headline, remediation outlook, gate count) over
**developer detail** (prerequisites checklist, per-pattern findings). Keep both
scannable — not exhaustive. Do not invent a different layout.

Use the **report bucket labels** in the output (internal → report):

| Internal | Report label |
|----------|--------------|
| AI fix | AI Fix |
| AI + Dev | AI + Developer Fix |
| Redesign | Architectural Redesign |
| Assessment inconclusive | Assessment Inconclusive |

The headline "AI-remediable" figure counts only **AI Fix + AI + Developer Fix**;
Architectural Redesign and Assessment Inconclusive are not AI-remediable. Whenever a
"successor available" finding resolves to a write whose successors are read-only CDS
views, the report **must** include the caveat that those successors are navigation
guides, not write targets — see the reference.

## Boundaries

- This skill **assesses and categorizes only**. Do not output remediated ABAP.
  The deliverable is the HTML Clean Core Assessment report (Step 5), not fixed code.
- It covers the clean-core ATC findings listed in the dispatch table. The DDIC-write
  and object-modified modules are active today; the other listed messages are
  skeletons, and any message not in the table is out of scope.
- Do not re-run ATC and do not query the Cloudification Repository; the finding
  already carries the successor verdict.

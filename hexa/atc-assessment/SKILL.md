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

This skill assesses ATC clean-core findings where custom ABAP writes directly to
an SAP-owned DDIC table or table view, and assigns each one an effort category.
It is an **assessment** activity: the goal is to understand the finding and route
it, **not** to write the corrected code. Fixing is a later phase.

It handles exactly these two message titles from the `Usage of APIs` check:

| Check Title  | Message Title |
|--------------|---------------|
| Usage of APIs | Updating DDIC database tables or DDIC table views is not allowed |
| Usage of APIs | Updating DDIC database tables or DDIC table views is not allowed (successor available) |

Both are the **same rule** with two branches: a direct write to an SAP DDIC
table/view is never permitted under clean core, so the finding is always a hard
error. The only difference is whether SAP's classification attached a successor.

## The four effort buckets

Route every finding to exactly one:

- **AI fix** — deterministic and low-context. The correct replacement is knowable
  from the code and the finding alone, with no business-logic judgment and no
  transactional side effects to validate. An assistant could produce the final
  change unattended. In practice this is reachable **only for the read-swap case**
  (see Branch A) — never for a write.
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
- **Referenced object** — the SAP table/view being written (e.g. `USH02`, type
  `TABL`), plus its package, software component, and application component if
  given. These identify the table's owning area and help judge its role.
- **Successor present or not** — read this from the finding itself. The
  "(successor available)" variant means SAP attached a successor; the plain
  variant means it did not ("Not specified"). **Do not query the Cloudification
  Repository for this** — the ATC check already resolved it against that repo when
  it produced the finding, so a lookup only returns the same answer.
- **Confirm it is a write.** Reading an SAP DDIC table is only a warning;
  *modifying* it is the error. This message is the write case by definition, but
  keep it in mind when you read the source — the flagged statement is an
  `INSERT` / `UPDATE` / `MODIFY` / `DELETE`.

Note the finding is non-suppressible (no pragma / pseudo-comment), so the only
valid outcomes are genuine remediation or a formal ATC exemption — never
silencing it.

### Step 2 — Read the source in the workspace

The finding names the object and table but not the logic. **Before classifying,
read the referenced object's code from the open VS Code workspace.** This is what
turns a guess into an assessment, and it is the difference between a real bucket
and "Assessment inconclusive."

**Start from the objects the user has opened or attached as context** — those are
the source of truth the user pointed you at. Read them first, then search the
workspace for any referenced includes/routines they don't already cover.

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

Reading the code resolves the four things the finding omits: the **verb and
fields written**, the **intent**, the **feasibility** of an API mapping, and the
**sensitivity in context**.

### Step 3 — Classify the table's role (intent)

Using the source plus the table's area, classify what the write is really doing.
The role drives the Branch B routing:

- **Business / master / transactional data** (e.g. a material, order, or
  document table) → owned by a released transactional API or business object.
- **Configuration / customizing** (settings written from code) → should not be
  written from code at all.
- **Log / history / temporary** (audit/history tables; often delivery class `L`
  or `G`, delivered empty) → there is **no write API by design**; SAP populates
  these internally when the owning process runs. A custom program writing here is
  doing something SAP's own logic should do.

### Step 4 — Route by branch

**Branch A — successor present ("… (successor available)").**
Do not trust the successor blindly for a write. Table successors are frequently
**read** CDS interface views, which do not solve a write.

- If the flagged operation is a **read**, or the successor is a **write-capable
  API/behavior that matches the operation** → the target is handed to you.
  - read / `SELECT` swapped for the successor CDS view → **AI fix**
  - write performed through the named released API with LUW handling → **AI + Dev**
- If the successor is a **read view but the operation is a write** → the successor
  does not resolve the finding. Treat it as effectively no-successor and fall
  through to Branch B.

**Branch B — no successor (plain message, or fell through from A).**
SAP's classification gives nothing, so reason about which behavior owns the
table's data, driven by the Step 3 role:

- **Business / master / transactional** → identify the owning released API/BO and
  map the written fields to it. Every field maps → **AI + Dev**. A field has no
  API path → **Redesign** (for the part that cannot be mapped).
- **Configuration / customizing** → **Redesign** (move to customizing or a
  maintenance API; remove the write from code).
- **Log / history / temporary** → **Redesign** — remove the direct write and let
  the owning operation write the record — or **Assessment inconclusive** if the
  program's intent is genuinely unclear.

#### Always propose a candidate write API (the D → B/A lift)

The point of the assessment is to move findings **out of Assessment Inconclusive
(D)** toward **AI + Developer Fix (B)** or **AI Fix (A)** — never to leave a route
empty when a plausible target exists. So for every write, name at least one
**concrete candidate write API/behavior** in the record's "Derived write API"
field, derived from the table plus the source context, in this priority order:

1. **Released RAP business object / released API** for the table's business object
   — the clean-core-preferred target (e.g. the **Product** BO/API for `MARA`).
2. **Owning BAPI / released function module** that writes the table
   (e.g. `BAPI_MATERIAL_SAVEDATA` for `MARA`, `BAPI_*_CHANGE/_CREATE` for other
   business objects) — propose it even though its released / clean-core status
   still has to be confirmed.
3. **Maintenance / customizing API** for configuration tables; the **owning
   process/behavior** for log/history tables.

Rules for the candidate:

- **A named candidate lifts the route from D to B.** A business/master write with
  at least one plausible candidate API is **AI + Developer Fix**, not Assessment
  Inconclusive. Only a genuinely unknown owner (no plausible candidate) stays D;
  no mappable path at all → **Redesign**.
- **Candidate ≠ verified.** Every proposed API carries release-status *to verify*
  and becomes a **prerequisite row** in the report (is it released / clean-core
  on the target release, and is each written field write-exposed there). This
  keeps the optimistic bucket honest — see Step 6 and the report format.
- **Prefer released over classic.** When both exist, lead with the released
  RAP/API and list the classic BAPI as the fallback the developer can fall back to
  if the released path lacks a needed field — never present a non-released BAPI as
  the clean-core end state without that caveat.

These override the branch result:

- **Writes never reach AI fix.** Commit / lock / validation side effects mean any
  write needs at least developer validation. AI fix is reachable only for the read
  swap in Branch A.
- **Sensitivity.** Security, user/authentication, or financial tables force a
  **mandatory human/security review** regardless of the computed bucket; they
  never route to an unattended fix. Flag this explicitly in the record.
- **Missing source or ambiguous intent** → **Assessment inconclusive (source
  required/unavailable)**, with the provisional route noted.

### Step 6 — Compile the record, then render the report

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
`assets/report-template.html`, following `references/report-format.md` exactly. The
report is one page for two readers: a concise **management summary** (readiness
headline, remediation outlook, gate count) over **developer detail** (prerequisites
checklist, per-pattern findings). Keep both scannable — not exhaustive. Do not invent
a different layout. Read the reference before rendering.

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

## Worked examples

**Example 1 — successor present, but read-only (falls through to Branch B).**
Input: `Updating DDIC ... not allowed (successor available)` on an `UPDATE` to a
material master table. Reading the code shows a genuine write of business fields.
The attached successor is a set of released `I_Product*` **read** CDS views — no
help for a write. Branch A falls through to Branch B; role is business/master;
owning behavior is the released Product API/BO; the written fields map to it.
→ **AI + Dev** (AI drafts the API-based write + LUW; developer validates and
tests). Not AI fix (it is a write).

**Example 2 — no successor, history table.**
Input: `Updating DDIC ... not allowed` on `ZSUSLOCK` (`PROG`) writing `USH02`
(`TABL`, change history for logon data, delivery class `L`). No successor. Reading
the code confirms it manipulates user lock state and writes the history entry
directly. Role is log/history: there is no write API for `USH02` by design — SAP
writes it when a user operation goes through the standard user-admin behavior. The
direct write should be removed, not swapped. Security-sensitive → review
mandatory.
→ **Redesign** (remove the manual history write; perform the user operation
through the owning behavior so SAP writes the history), or **Assessment
inconclusive** if the source cannot be read. Never AI fix.

## Boundaries

- This skill **assesses and categorizes only**. Do not output remediated ABAP.
  The deliverable is the HTML Clean Core Assessment report (Step 6), not fixed code.
- It covers only the two DDIC-write message titles above. Other `Usage of APIs`
  messages (e.g. `PERFORM program is not allowed`), modification findings, or
  enhancement-technology findings are out of scope for this skill.
- Do not re-run ATC and do not query the Cloudification Repository; the finding
  already carries the successor verdict.

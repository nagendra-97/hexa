# Finding module — PERFORM program is not allowed

> **STATUS: ACTIVE.** Authored and in use.

- **Check title:** Usage of APIs
- **Message title:** PERFORM program is not allowed

Use this module together with the shared four buckets, workflow skeleton,
read-source step, shared overrides, and report step in [../SKILL.md](../SKILL.md).
This module supplies the PERFORM-specific parsing, the two-axis classification
(ownership × what the routine does), and the branch routing — including the
researched redesign paths.

## Contents
- Scope
- Step 1 — Parse the finding
- Step 2 — Read the source
- Step 3 — Classify (two axes: ownership × routine behavior)
- Step 4 — Route into the four buckets (with researched redesign paths)
- Overrides & sensitivity
- Report cells (PERFORM-specific record fields)
- Worked examples

## Scope

"PERFORM program is not allowed" flags an **external subroutine call into another
program** — `PERFORM <form> IN PROGRAM <prog>` (including the dynamic
`PERFORM (name) IN PROGRAM <prog>` form). Clean core rejects it for two reasons at
once: FORM routines are an obsolete procedural construct, **and** a subroutine inside
another program is never a released, stable contract. The remediation target is a
**released, callable API surface** — a released BAPI / function module / class method,
or a local refactor into a class method — **not** a CDS successor (as in DDIC-write)
and **not** an extension hook (as in object-modified).

Two properties make this finding distinct to assess:

- **The finding is feasibility-silent.** Unlike the DDIC-write finding, there is **no
  "successor available" variant** — the ATC finding tells you nothing about whether a
  replacement exists. Reading the source and *deriving the candidate yourself* carries
  the entire weight of the routing.
- **The data crossing the `PERFORM` boundary matters.** The `USING` / `CHANGING` /
  `TABLES` parameters are the contract that any replacement must re-plumb; an unmapped
  parameter is what pushes a case from AI + Developer Fix down to Architectural
  Redesign.

The finding is typically non-suppressible (no pragma / pseudo-comment), so the only
valid outcomes are genuine remediation or a formal ATC exemption — never silencing it.

## Step 1 — Parse the finding

Extract, from the finding row/text:

- **Consuming object** — the custom object that contains the `PERFORM` statement
  (name + type, e.g. a custom program or function group). This is where the source
  lives.
- **Referenced object** — the called program (name + type `PROG`), plus its package,
  software component, and application component if given. These identify **who owns
  the called program** — the first routing axis. A software component like `S4CORE`
  (and a package flagged legacy, e.g. a `*_OLD` package) signals an SAP-owned,
  frequently superseded target.
- **PERFORM-specific attributes** — read from the source in Step 2, not from the
  finding: the **FORM name(s)** called and the **parameters crossing the boundary**
  (`USING` / `CHANGING` / `TABLES`). The finding names the program but not the form or
  its contract.

Note there is no successor field to read here — the finding does not carry a
remediation verdict. Do not query the Cloudification Repository for one; derive the
candidate target from the source and the called program's role.

## Step 2 — Read the source

The finding names the consuming object and the called program but not the logic.
**Before classifying, read the consuming object's source and locate each
`PERFORM … IN PROGRAM` statement**, then extract exactly the inputs the routing
branches on:

- **Ownership of the called program** (Axis A) — SAP-owned vs. customer-owned.
- **What the called routine does** (Axis B) — a transactional/business operation, a
  pure utility/computation/read, or a legacy batch-/direct-input driver. Read the
  called FORM's body when it is available (the SAP program is often a read-only ADT
  virtual document); when it is not readable, infer the behavior from the program's
  role and the parameters passed, and record the gap.
- **The `PERFORM` contract** — the `USING` / `CHANGING` / `TABLES` parameters, because
  reproducing the call through an API means re-plumbing those exact inputs and
  outputs.

**Enumerate the finding's objects and let the developer pick the scope first.** As in
the shared read-source step, a finding often names a **container** (e.g. a function
group) whose `PERFORM` sites are spread across several includes / function modules.
Enumerate the container's members from the ADT virtual filesystem, present them as
selectable options, and read every selected object — following the call chain into
includes — before assessing.

The ABAP/ADT virtual-document rules in `../SKILL.md` apply: opened programs are
read-only virtual documents; read the open tabs / attached context rather than marking
source unavailable because on-disk search missed them.

**Precedence:** source read from the workspace outranks any inference from the program
name. If the **consuming source cannot be read** — or the called routine's behavior is
genuinely undeterminable and no parameter contract can be recovered — that gap feeds
**Assessment inconclusive (source required)**, with the provisional route noted.

## Step 3 — Classify (two axes)

Routing is decided by two orthogonal questions, not one.

**Axis A — Ownership of the called program.**

- **SAP-owned** (the referenced `PROG` belongs to an SAP software component) — the
  true clean-core coupling: the fix is a **released SAP API** that reproduces the call.
- **Customer-owned** (a `Z`/`Y` program) — not an SAP-API gap at all; it is a
  **modularization** problem. The fix is refactoring the FORM into a callable class
  method / local released API, keeping the logic in custom code.

**Axis B — What the called routine does.**

- **Transactional / business operation** — posts, updates, or drives a document or
  master record → owned by a released API/BAPI/BO.
- **Utility / pure computation / read** — formatting, conversion, a lookup, a
  side-effect-free calculation → may have a released class/FM equivalent, or is cheap
  to reimplement locally.
- **Legacy driver** — a batch-/direct-input program (e.g. a classic `RM*` maintenance
  driver) → superseded by a released API by design.

## Step 4 — Route into the four buckets

Combine the two axes:

- **Customer-owned FORM (any behavior)** → **AI + Developer Fix.** Refactor the
  subroutine into a class method / local released API and replace the external
  `PERFORM`; a developer validates behavioral parity and tests. This is a
  modernization, not an SAP-API gap.
- **SAP-owned + utility/pure-compute with a released 1:1 equivalent, no transactional
  side effects** → **AI Fix** *(rare — the only door to AI Fix for this finding)*. A
  deterministic swap of the external `PERFORM` for a released class/FM call, knowable
  from the code alone. This is the direct analogue of DDIC-write's read-swap.
- **SAP-owned + transactional / legacy driver, and a released API/BAPI/method
  reproduces it** → **AI + Developer Fix.** AI drafts the API-based call with LUW /
  lock / authorization handling; a developer validates semantics and tests.
- **SAP-owned + no released API reproduces the call** → **Architectural Redesign**
  (see the researched paths below).
- **Source unreadable or intent/contract undeterminable** → **Assessment
  Inconclusive (source required)**, with the provisional route noted.

### Always propose a candidate target (the D → B/A lift)

Because the finding is feasibility-silent, **name at least one concrete candidate
released target** in the record's "Derived target" field for every finding — a
released API/BAPI for a business op, a released class/FM for a utility, a local class
method for a customer-owned FORM. A named candidate lifts the route out of Assessment
Inconclusive toward AI + Developer Fix. **Candidate ≠ verified:** each proposed target
carries a release-status-to-verify and a parameter-mapping-to-verify, which become
**prerequisite rows** (Status Open, verified count 0). Prefer released over classic —
lead with the released API and list a classic BAPI/FM as the fallback with that caveat.

### Architectural Redesign — research the solution paths

When no released API reproduces the call, **do not stop at the bucket.** Research and
enumerate concrete redesign paths, ranked by clean-core preference, each with a
feasibility note and a verification prerequisite — the Redesign-tier analogue of the
D → B lift. Never leave Redesign as an empty verdict. Candidate paths, in order:

1. **Recompose from finer-grained released APIs** — no single API matches, but a
   *sequence* of released APIs/BOs reproduces the business outcome (the common case
   for legacy drivers).
2. **Invert control into a released extension** — move the logic into a released
   BAdI / event of the owning process so the standard process invokes it, instead of
   custom code calling into the standard.
3. **Re-platform the flow** — replace a legacy batch-/direct-input driver with the
   standard application's released service (RAP BO / OData / released FM) and drive
   that.
4. **Custom reimplementation** — when the called FORM was pure utility/compute with no
   released equivalent, reimplement it in a custom class (redesign-lite; removes the
   SAP-internal dependency without an SAP API).
5. **Eliminate** — the call is obsolete on S/4 (the function is now automatic or has
   been removed) → drop it.
6. **Formal exemption** — last resort; a decision, not a code task → surfaces as a
   prerequisite row with an owner.

The record states **what the redesign must deliver** and **which path is
recommended**, so the bucket is a starting point for work, not a wall.

**PERFORM override on the branch result:**

- **Transactional PERFORMs never reach AI Fix.** Commit / lock / authorization side
  effects mean any transactional replacement needs at least developer validation. AI
  Fix is reachable only for the SAP-owned, side-effect-free utility swap.

(The shared sensitivity and missing-source overrides in `../SKILL.md` also apply —
security / user / financial targets force a **mandatory human/security review**
regardless of the computed bucket.)

## Report cells

This finding has no write API and no successor; it maps onto the shared Findings-
detail columns (`../references/report-format.md`, Section D) as follows:

| Shared column | PERFORM-not-allowed content |
|---------------|-----------------------------|
| Object · Type | consuming object · type (where the `PERFORM` lives) |
| Table | the external target — called program · FORM (`⚠ <domain>` prefix when security/user/financial) |
| Operation | `PERFORM` (external call); tag ownership `SAP` / `customer` |
| Field(s) | the FORM name + parameters crossing the boundary (`USING` / `CHANGING` / `TABLES`) |
| Location(s) | include/line of each `PERFORM` site (count + list if repeated) |
| Derived write API | **Derived target** — released API/BAPI/method or local class method; `None — see redesign paths` for redesign |
| Confidence · Fix approach · Next step | per the shared report step |

Footer ATC-variant note: `PERFORM external call (no successor)`. There is no
read-only-successor caveat for this finding; instead, when the derived target is a
**classic** BAPI/FM rather than a released API, note it as the fallback and raise the
released-status prerequisite. For Redesign findings, list the recommended researched
path and its prerequisite.

## Worked examples

**Example 1 — SAP-owned legacy driver, released API exists.**
A custom function group calls `PERFORM … IN PROGRAM` a classic material-master
maintenance driver to post material data. The called routine is transactional; the
material-master API reproduces it. → **AI + Developer Fix** — draft the API-based
write with LUW handling; developer maps the `USING`/`TABLES` fields and validates.
Prerequisite: confirm the API is released and covers every passed field on the target
release. Not AI Fix (transactional).

**Example 2 — SAP-owned utility, released 1:1 equivalent.**
A custom report calls `PERFORM … IN PROGRAM` an SAP utility routine that only formats
or converts a value, with no database side effect, and a released class method does
exactly the same. → **AI Fix** — deterministic swap of the `PERFORM` for the released
method call. This is the sole AI-Fix case for this finding.

**Example 3 — SAP-owned, no released API → researched redesign.**
A custom program calls a legacy batch-input driver whose behavior no single released
API reproduces. → **Architectural Redesign** — researched paths: (1) recompose from
finer-grained released APIs; (2) re-platform onto the standard app's released service.
Record names the recommended path and its prerequisite (verify the released services
cover the driver's outcome on the target release). If no path is feasible → formal
exemption pending decision → **Assessment Inconclusive**.

**Example 4 — customer-owned FORM.**
A program calls `PERFORM … IN PROGRAM` a subroutine in another **custom** program. No
SAP-API gap — a modularization issue. → **AI + Developer Fix** — refactor the FORM
into a class method / local released API and replace the external `PERFORM`; developer
validates parity. Prerequisite: confirm no other caller depends on the old external
form signature.

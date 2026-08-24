# Finding module — Updating DDIC database tables or DDIC table views is not allowed

> **STATUS: ACTIVE.** Authored and in use.

- **Check title:** Usage of APIs
- **Message title:** Updating DDIC database tables or DDIC table views is not allowed
- **Message title (variant):** Updating DDIC database tables or DDIC table views is not allowed (successor available)

Use this module together with the shared four buckets, workflow skeleton, read-source
step, shared overrides, and report step in [../SKILL.md](../SKILL.md). This module
supplies the DDIC-write–specific parsing, table-role classification, and branch
routing.

## Contents
- Scope
- Step 1 — Parse the finding
- Step 3 — Classify the table's role (intent)
- Step 4 — Route by branch
- Report cells (DDIC-specific record fields)
- Worked examples

## Scope

Both message titles are the **same rule** with two branches: a direct write to an
SAP DDIC table/view is never permitted under clean core, so the finding is always a
hard error. The only difference is whether SAP's classification attached a
successor.

## Step 1 — Parse the finding

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

## Step 3 — Classify the table's role (intent)

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

## Step 4 — Route by branch

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

### Always propose a candidate write API (the D → B/A lift)

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
  keeps the optimistic bucket honest — see the shared report step and the report
  format.
- **Prefer released over classic.** When both exist, lead with the released
  RAP/API and list the classic BAPI as the fallback the developer can fall back to
  if the released path lacks a needed field — never present a non-released BAPI as
  the clean-core end state without that caveat.

**DDIC-write override on the branch result:**

- **Writes never reach AI fix.** Commit / lock / validation side effects mean any
  write needs at least developer validation. AI fix is reachable only for the read
  swap in Branch A.

(The shared sensitivity and missing-source overrides in `../SKILL.md` also apply.)

## Report cells

Per DDIC-write finding, supply these finding-specific fields to the shared report
step: **operation (verb) + fields written** · **code location
(include/method/line)** · **successor + kind** · **derived write API/behavior** ·
**write-path feasibility**. Whenever a "successor available" finding resolves to a
write whose successors are read-only CDS views, the report **must** include the
caveat that those successors are navigation guides, not write targets.

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

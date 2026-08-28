# Finding module — Object is modified

> **STATUS: ACTIVE.** Authored and in use.

- **Check title:** Detect customer modifications
- **Message title:** Object is modified

Use this module together with the shared four buckets, workflow skeleton,
read-source step, shared overrides, and report step in [../SKILL.md](../SKILL.md).
This module supplies the modification-specific reconstruction, intent analysis,
enhancement-option research, and branch routing.

## Contents
- Scope
- Step 1 — Reconstruct the change (parse + diff)
- Step 2 — Read the source (both versions)
- Step 3 — Understand intent + classify the change
- Step 4 — Research options, then route
- Step 5 — Evaluate (confidence + prerequisites)
- Report cells (modification-specific record fields)
- Worked examples

## Scope

"Object is modified" means a customer changed an **SAP-delivered object in place** — a
modification/repair applied under an access key, or an overwritten standard include,
routine, or method — instead of extending it through a released extension point.
Under clean core no SAP standard object may be modified, so the finding is always a
hard error. Unlike the DDIC-write finding there is **no "successor available"
variant**: the remediation target is a released **extension option** (BAdI /
enhancement spot / exit), not a write API. Everything else — the four buckets, the
workflow, the shared overrides, the report — is shared with `../SKILL.md`.

The finding is typically non-suppressible (no pragma / pseudo-comment), so the only
valid outcomes are genuine remediation or a formal modification/ATC exemption — never
silencing it.

## Step 1 — Reconstruct the change (parse + diff)

Extract, from the finding row/text:

- **Modified object** — the SAP standard object flagged (name + type: `PROG`,
  `INCL`, `CLAS`, `FUGR`, …), plus its package, software component, and application
  component if given. For this finding the consuming and referenced object are the
  **same** object — the modification lives inside the standard object itself.
- **Modification kind**, if the finding carries it (modification vs. enhancement
  vs. repair).

Then **reconstruct what actually changed** by diffing the customer version against
the SAP standard (Version Management, the modification browser, or the object's
original), decomposing the change into three sets:

- **Additions** — new statements / routines / methods the customer inserted.
- **Replacements** — standard logic the customer rewrote.
- **Removals** — standard logic the customer commented out or deleted.

Record each changed unit with its location (include/method/line). This decomposition
is the anchor for everything downstream — intent, option research, and
functional-equivalence checks all reference these three sets.

## Step 2 — Read the source (both versions)

Reading only the modified version is not enough: you must see it **against the SAP
original** to know what the change *did*, not just what the code says now. Read from
the workspace/ADT:

- the modified object and its enclosing program/class;
- the **SAP original** (version history / active-vs-modified);
- the routines/methods and data the change depends on, following the call chain.

The ABAP/ADT virtual-document rules in `../SKILL.md` apply — opened standard objects
are read-only virtual documents; read the open tabs/attached context rather than
marking source unavailable because on-disk search missed them.

A modification made **with the Modification Assistant** carries inline
`*{ INSERT }*` / `*{ REPLACE }*` / `*{ DELETE }*` markers (or SE95 entries) that hand
you the diff directly; a **classic modification (no Assistant)** has no markers and
depends on Version Management (active-vs-delivered) to reconstruct — so an
unretrievable original is the common trigger for *Assessment Inconclusive* here. The
technique never changes the bucket (routing is driven by the ADD/REPLACE/REMOVE shape
and hook availability), only how cheaply the diff is obtained.

**Precedence:** source read from the workspace outranks any inference from the object
name. If the **original SAP version cannot be retrieved** (no version history, source
unavailable), the change cannot be reconstructed → **Assessment inconclusive
(original/source unavailable)**, noting exactly what is missing.

## Step 3 — Understand intent + classify the change

From the reconstructed diff plus the surrounding code, state the **business outcome**
the modification was trying to achieve — what would break if it were reverted. Then
classify along the two dimensions that drive routing.

**Change shape** (from Step 1):

- pure **addition** — extra logic at a point, standard flow otherwise intact;
- **replacement** — standard behavior altered;
- **removal** — standard behavior suppressed.

**Intent locus** — where the business outcome belongs:

- an **extension point exists** at the modified location (a released BAdI /
  enhancement spot / exit covers exactly this hook);
- the outcome belongs **outside the core** (configuration, or a separate custom
  app/BO consuming released APIs);
- the outcome requires **changing standard behavior** with no released hook
  (suppressing or replacing standard logic);
- intent is **unclear / not reconstructable**.

## Step 4 — Research options, then route

**Research released enhancement options for the modified location before routing.**
Search for BAdIs and enhancement spots (SE18/SE80), classic BAdIs, customer exits
(SMOD/CMOD), user exits, explicit/implicit enhancement points, and BTE or other
published hooks that cover the change's location and intent. Name at least one
concrete candidate whenever one plausibly exists — this is the same **D → B lift** as
DDIC-write: never leave the route empty when a released hook could carry the intent.

Map the four remediation options onto the shared buckets:

- **Option A — Move outside core** and **Option B — Released extension**: a released
  extension point can reproduce the modification's intent → **AI + Developer Fix**.
  The AI drafts the extension implementation (move the added/replaced logic into the
  released hook, or out to configuration / a released-API-based custom app); a
  developer validates **functional equivalence** against the original modification,
  LUW / authorization / behavioral parity, and tests. This is the target outcome for
  additions and for replacements that a released hook can host.
- **Option C — Redesign process**: the intent has **no released hook** — e.g. the
  change suppresses or replaces standard behavior with no extension point, or the
  outcome needs a different process or data model → **Architectural Redesign**. The
  record names what has no hook and what the redesign must deliver.
- **Option D — Exception**: keeping the modification via a formal modification/ATC
  exemption is a **decision, not a code task**. It surfaces as a prerequisite row
  (the decision + its owner). When an exemption is the only remaining path and
  remediation is genuinely infeasible, route the finding to **Assessment
  Inconclusive** with "formal exemption pending decision" as the provisional route —
  never silently keep the modification.

**Modification override on the branch result:**

- **Modifications never reach AI Fix.** Reproducing a modification always carries
  business intent and behavioral parity that a developer must validate — like a DDIC
  write, it needs at least developer validation. AI Fix is not reachable for this
  finding.
- **Removals are the hardest.** A pure removal (standard logic switched off) usually
  has no additive hook → **Redesign** or **Exception**, unless a released
  switch/BAdI can disable the same behavior cleanly (→ **AI + Developer Fix**).
- **Prefer released over classic.** When both exist, lead with the released
  BAdI/enhancement spot and list a classic exit as the fallback — never present a
  classic/non-released exit as the clean-core end state without that caveat.

(The shared sensitivity and missing-source overrides in `../SKILL.md` also apply —
security / user / financial standard objects force a **mandatory human/security
review** regardless of the computed bucket.)

## Step 5 — Evaluate (confidence + prerequisites)

Before finalizing each pattern, evaluate the proposed option on these axes; they set
Confidence and populate the prerequisite rows:

- **Feasibility** — can the released hook actually be implemented here?
- **Functional equivalence** — does it reproduce the additions / replacements /
  removals exactly?
- **Clean-core level** — released/stable hook vs. classic exit (prefer released).
- **Technical impact** — call sequence, performance, data touched.
- **Evidence quality** — was the original reconstructed from version history, or
  inferred?

Each candidate hook carries a **release-status-to-verify** and a
**functional-equivalence-to-verify**, which become **prerequisite rows** (Status
Open, verified count 0) — the same honesty guardrail as DDIC-write: an
"AI-remediable" figure is a potential, not a proven fix.

## Report cells

This finding has no write API and no successor; it maps onto the shared Findings-
detail columns (`../references/report-format.md`, Section D) as follows:

| Shared column | Object-modified content |
|---------------|-------------------------|
| Object · Type | host object · type (the modified standard object, or its enclosing program/class) |
| Table | the modified SAP unit — include / routine / method / class (`⚠ <domain>` prefix when security/user/financial) |
| Operation | change kind: `ADD` / `REPLACE` / `REMOVE` (combine when a pattern mixes shapes) |
| Field(s) | the changed units — routine/method names or statements touched |
| Location(s) | include/method/line of each change site (count + list if repeated) |
| Derived write API | **Derived extension option** — the released BAdI / enhancement spot / exit, or `None — no released hook` for redesign |
| Confidence · Fix approach · Next step | per the shared report step |

Footer ATC-variant note: `modification (no successor)`. There is no
read-only-successor caveat for this finding; instead, when the derived option is a
**classic** exit rather than a released BAdI, note it as the fallback and raise the
released-status prerequisite.

## Worked examples

**Example 1 — addition with a released BAdI.**
A standard sales-order save include is modified to insert an extra validation.
The diff shows a pure **addition**; a released BAdI covers the save hook. Intent:
enforce a custom check at save. → **AI + Developer Fix** — reimplement the check in
the released BAdI, validate equivalence and save LUW, then remove the modification.
Prerequisite: confirm the BAdI is released and fires at the same point on the target
release.

**Example 2 — replacement with no hook.**
A standard pricing routine is rewritten in place to change how a value is derived; no
released BAdI/exit exposes that step. Intent: alter core pricing behavior. →
**Architectural Redesign** — no released hook reproduces the change; redesign the
requirement through a released pricing extension or a process change. If neither
exists → **Assessment Inconclusive** with "formal exemption pending decision."

**Example 3 — original unavailable.**
An object is flagged as modified, but version history is gone and the SAP original
cannot be retrieved, so the change cannot be reconstructed. → **Assessment
Inconclusive (original/source unavailable)**; prerequisite: retrieve the SAP standard
version to enable the diff. Never AI Fix.

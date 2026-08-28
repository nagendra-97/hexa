# Fix module — Updating DDIC database tables or DDIC table views is not allowed

> **STATUS: ACTIVE.** Authored and in use.

- **Check title:** Usage of APIs
- **Message title:** Updating DDIC database tables or DDIC table views is not allowed
- **Message title (variant):** Updating DDIC database tables or DDIC table views is not allowed (successor available)

Use this module together with the shared workflow, level-targeting priority, and
suggestion format in [../SKILL.md](../SKILL.md). This module supplies the
DDIC-write–specific code generation.

## Scope

Every DDIC-write fix is a **write** remediation (`INSERT` / `UPDATE` / `MODIFY` /
`DELETE`) on an SAP DDIC table/view — a **Level D** pattern. Both message titles
collapse to the same fix shape: replace the direct write with a write API call and
lift the object to **Level A** (released API from the API Hub) or **Level B**
(classic upgrade-stable API reasoned from context).

- **Successor available** — a candidate is attached, but confirm it is
  **write-capable**. A read-only CDS view does not resolve a write; keep searching
  for a write-capable API.
- **No successor** — derive the owning API from the table + source context.

There is **no read-swap** in this module — the finding is always a write.

## Generation

### 1. Identify the write

From the re-read source, capture the flagged statement: the **verb**
(`INSERT`/`UPDATE`/`MODIFY`/`DELETE`), the **table**, the **written fields**, and
where the keys/values come from (single record vs. loop / mass write; guarded vs.
unconditional).

### 2. Build the target API call

- **Level A (on-stack) — released RAP BO.** The on-stack Level A write is a **released
  RAP business object** consumed via **EML** (`MODIFY ENTITIES … CREATE`/`UPDATE`),
  mapping **every** written field to a BO field. A released **OData/A2X** service (e.g.
  `API_*_SRV`) is **not** callable for write from ABAP — it is a side-by-side interface;
  name it as the released model but do **not** generate an ABAP OData call. If the only
  released target is OData and no on-stack RAP BO exists, drop to Level B. Always record
  the target's **supported S/4 release(s)** (`ReleaseInfo`) so the developer can confirm
  it exists in their system.
  - **`find_rap_bo`'s `fixApproach` decides Level A vs B.** `level A`/`A_partial` only
    when the BO is a concrete (non-abstract) writable BDEF released under
    **`#PUBLIC_LOCAL_API`**; a **`#PUBLIC_REMOTE_API`** or **abstract** BDEF (the OData
    wrapper) is remote-only → `level B`. Build the EML from `fixApproach.writeTarget`
    (`MODIFY ENTITIES <entity>`) and `mappedFields` (`db → boElement`, one per written
    column); route every `unmappedFields` entry to a **residual redesign** item.
- **Level B (classic API — fallback).** If no released RAP BO exists, call the reasoned
  classic API (e.g. `BAPI_*_CREATE`/`_CHANGE`) and map the written fields to its
  import parameters/tables. Flag it explicitly as Level B (upgrade-stable, not cloud).

### 3. Scaffold the LUW / semantics

DDIC writes carry transactional side effects that a direct statement handled
implicitly. The generated call must make them explicit for the developer:

- **Commit / rollback** — use the API's save/commit path (e.g. `COMMIT ENTITIES` /
  `BAPI_TRANSACTION_COMMIT`), not a bare `COMMIT WORK`, and roll back on error.
- **Locking** — acquire/release the API's enqueue where the direct write assumed none.
- **Return handling** — capture and evaluate the API's `BAPIRET2` / RAP `REPORTED` /
  `FAILED` and surface errors instead of silently continuing.
- **Mass writes** — preserve loop/set semantics; prefer the API's set-based path over
  calling it per row where available.

### 4. Encapsulate reusable logic in OO ABAP (Clean ABAP)

When the same remediation applies at **more than one site** (a pattern repeated `×N`, or
a write reached from several includes/routines), do **not** generate a `FORM` subroutine
or copy the call inline at each site. Encapsulate the API call + LUW/return handling in a
**method of a (local) class** and call that method at each site. This follows Clean ABAP
and moves the code off the legacy procedural style the finding lives in.

- Prefer a small **local class** (`CLASS lcl_… DEFINITION`/`IMPLEMENTATION`) in the
  object, or a reusable global class where the logic is shared beyond one program.
- The method takes the **key + written value(s)** as importing parameters and returns a
  result/return structure; the caller passes each site's value (e.g. the status code).
- Keep the method single-purpose; no side effects beyond the intended write + its LUW.
- A single, unconditional, one-off write may stay inline — introduce the class when there
  is genuine reuse, not for its own sake.

### 5. Field-mapping honesty

Map each written field to a target-API field. If **every** field maps → the fix is
complete at Level A/B. If a field has **no** API path, do not fake it: generate the
mappable part and flag the unmapped field as a **residual redesign item** for that
portion (a finding can split into a fix plus a residual).

### 6. No-API case (redesign / inconclusive)

If neither a released (Level A) nor a plausible classic (Level B) API exists — e.g.
configuration tables (write belongs in customizing) or log/history tables (SAP writes
them via the owning process) — produce **no drop-in snippet**. Consult **Note Search**
and **Roadmap**, then propose the remediation **direction** (owning process/behavior,
customizing move, data-model change) with reasoning and the decision/owner.

## Suggestion format (DDIC-specific cells)

Supply these to the shared suggestion format (fill the fixed Fix-block rows — never add,
drop, or reorder them):

- **Pattern header** — object · type · **table** · **operation (verb)** · **written
  fields** · location(s) (`×N` if repeated).
- **Level transition** — `D → A (released <api>)` · fallback `D → B (classic <api>)`, or
  just `D → B (classic <api>)` when no Level A, or `D → redesign/inconclusive`.
- **Field resolution** — the DB-field → CDS-element trail and the exposed element name on
  the released BO, taken from `find_rap_bo`'s `fieldMappings[]` (`trail` + `exposedName`) —
  one row per written column, e.g.
  `WRKST → I_Product.BasicMaterial → R_ProductTP.BasicProduct → A_Product_2.BasicProduct`;
  `n/a` when no successor / BO was resolved.
- **Before → after** — flagged write vs. the API-based call **with LUW handling**. When
  both levels exist, show **Option A (Level A / EML)** then **Option B (Level B / classic,
  fallback)**, in that order; show only the applicable Option when one level exists.
- **Field mapping** — the fixed four columns `Written field | Level A target | Level B
  target | Mapped?` (`—` for an absent level); flag any unmapped field as a residual
  redesign item.
- **Verify before shipping** — the Level A gate (field not read-only on the BO projection;
  BO released for on-stack EML on the target release) and the Level B gate (classic API is
  the intended upgrade-stable path; accepts the written values).
- **Sensitivity flag** — mark security/user/financial writes as review-mandatory
  regardless of level.

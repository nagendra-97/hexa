# Clean Core Assessment — report format

One page, two readers: a **management summary** at the top (exposure, size, risk,
what's blocking) and **developer detail** below (what to change, what to verify
first). Keep every section scannable — if a section needs scrolling to parse, it's
too long. Build from `assets/report-template.html`; the layout is fixed.

Two framing rules keep the report honest and useful:

- **Count distinct remediation patterns, not just raw findings.** The same write
  repeated N times is one pattern applied in N places — one thing to solve. Always
  show both: `<findings> findings → <patterns> pattern(s)`.
- **Assessed ≠ verified.** This skill assesses; it verifies nothing on the customer's
  stack. So "AI-remediable" is a *potential*, never a proven fix — the open
  prerequisites (Section C) are what still has to be confirmed on the stack.

## Sections (in order)

### A. Summary  · KPI cards
**KPI stat cards**, not prose — each a big number with a small label so figures read
at a glance. Four cards: **Findings · Remediation patterns · AI-remediable % ·
Blockers to clear**. Blockers highlighted (amber). Below the cards, **one** compact
meta line: scope tag + message · object count · out of scope · target release · effort
note (after verification). No paragraphs. Use the specific S/4 release (API
availability is release-specific). The scope tag is the finding's **Check title**
(e.g. `Usage of APIs`, or `Detect customer modifications` for object-modified) — not
always `Usage of APIs`.

### B. Object Profile  · summary
Placed directly under the KPI cards, above the outlook. One row per consuming object.
Columns: **Object | Type | Package | Lines | Source | Findings | Patterns | Fix
approach**. Source = ✓ if the object's code was read (Step 2); a blank should
correlate with lower confidence. Fix approach = the object's roll-up (most severe)
bucket. Keep it thin — for a single object it's one row.

### C. Remediation Outlook  · summary
Table. Columns: **Fix approach | Findings | Patterns | Share | Distribution**.
Rows: AI Fix, AI + Developer Fix, Architectural Redesign, Assessment Inconclusive,
then **AI-remediable total** (= AI Fix + AI + Developer Fix). Show all four buckets
even at zero. Share = findings/total. Bar = share filled, remainder hatched.

### C. Before you code — prerequisites  · bridge (management sees the count, dev owns the items)
Replaces any vanity caveat with an actionable checklist. One row per prerequisite
that must hold before code is generated. Columns: **Object | Prerequisite | Status |
Owner**. Object = the consuming **Object · Type**, matching the first column of the
Findings detail (Section D) verbatim, so each prerequisite traces back to its finding
row. Status is **Open** at assessment time. Keep only the items that actually gate the
work — don't pad.
- Canonical item for a read-only-successor write: `Confirm field(s) <fields> are
  write-exposed and released via <derived write API> on <target release>.`
- For Architectural Redesign / Assessment Inconclusive findings, the prerequisite is
  the **decision** to make (fix vs. formal exemption, data-model change, read the
  source) with an owner — not a code task.

### D. Findings detail  · developers
Table, **one row per distinct remediation pattern** (not per raw finding). Columns:
**Object · Type | Table | Operation | Field(s) | Location(s) | Derived write API |
Confidence | Fix approach | Next step**.
- Operation = INSERT/UPDATE/MODIFY/DELETE; Field(s) = written fields.
- Columns carry a **finding-specific reading** — follow the matched module's *Report
  cells*. For **object-modified**: Table = the modified SAP unit, Operation = change
  kind (ADD / REPLACE / REMOVE), Field(s) = the changed routines/methods, and Derived
  write API = the derived **extension option** (released BAdI / enhancement spot /
  exit).
- Location(s) = include/method/line; if the pattern repeats, show count + list
  (e.g. `×5 · LMGXXF01:142,151,…`). This is what makes a row jump-to-able.
- Prefix `⚠ <domain>` on rows touching security/user/financial tables — mandatory
  review regardless of bucket.
- Confidence: Certain / Likely / Uncertain.

### Footer  · provenance
One muted line: `Target release · ATC variant · Cloudification Repo date · source
read <x>/<y> objects · assessed <date>`. Add a short **Assumptions / unknowns** note
when any exist (e.g. "source not read for OBJ2 — field mapping assumed").

## Scales

**Confidence** — *Certain* (write API directly matches, fields map) · *Likely*
(owning API known, field-level exposure needs stack verification — the common case) ·
*Uncertain* (intent/fields unclear, usually source unread → Assessment Inconclusive).

**Effort (indicative)** — *S*: read/CDS swap, or single-field write via a known
released API · *M*: multi-field write, or field mapping needs checking · *L*:
redesign, data-model change, or a field with no API path. Size the *pattern*, then
roll up (one pattern applied N places = one design effort + N light applications).

**Bucket labels (internal → report)** — AI fix → AI Fix · AI + Dev → AI + Developer
Fix · Redesign → Architectural Redesign · Assessment inconclusive → Assessment
Inconclusive.

## Consistency rules
- Findings and pattern counts in B reconcile with the rows in D.
- Each prerequisite's Object (C) matches a Findings-detail Object · Type (D) verbatim.
- AI-remediable total and the headline AI% agree; every open prerequisite in C
  counts toward the Blockers KPI.
- A read-only-successor write in AI + Developer Fix **must** have its matching
  prerequisite row in C — the optimistic bucket never stands alone.
- Writes never appear as AI Fix; AI Fix is the read-swap case only.

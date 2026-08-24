# Skill flow diagrams

High-level flow of the Hexa Clean Core Assessment skill and each finding module — so
you can see what happens *inside* the skill at a glance. For the exact rules, read the
module under [`../references/`](../references).

## Shared assessment workflow

```mermaid
flowchart TD
  I["Intake: atc_scan (default) or paste findings"] --> P["Parse finding: consuming + referenced object"]
  P --> R["Read source at the ATC location (fresh)"]
  R --> M{"Match message title to module"}
  M --> DW["DDIC-write"]
  M --> PF["PERFORM-not-allowed"]
  M --> OM["Object-modified"]
  M --> ET["Enhancement-technology (in progress)"]
  DW --> C["Route into 4 buckets"]
  PF --> C
  OM --> C
  C --> O["Overrides: sensitivity review; writes/mods never AI Fix; missing source to Inconclusive"]
  O --> G["Group into patterns; derive prerequisites"]
  G --> RP["Clean Core Assessment report (HTML)"]
```

**Buckets:** AI Fix · AI + Developer Fix · Architectural Redesign · Assessment Inconclusive.

## Per-module flows

- [DDIC-write](ddic-write.md) — ✅ active
- [PERFORM-not-allowed](perform-not-allowed.md) — ✅ active
- [Object-modified](object-modified.md) — ✅ active
- [Enhancement-technology](enhancement-technology.md) — 🚧 in progress

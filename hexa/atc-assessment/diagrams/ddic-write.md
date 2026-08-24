# DDIC-write — flow

Message: *Updating DDIC database tables or DDIC table views is not allowed
(± successor available)*. Rules: [`../references/ddic-write.md`](../references/ddic-write.md).

```mermaid
flowchart TD
  A["Write to SAP DDIC table (INSERT/UPDATE/MODIFY/DELETE)"] --> B{"Successor available?"}
  B -->|yes| A1{"Operation vs successor kind"}
  A1 -->|"read swapped for a CDS view"| AIFIX["AI Fix"]
  A1 -->|"write via released write API"| AIDEV["AI + Developer Fix"]
  A1 -->|"write, but successor is read-only CDS"| ROLE
  B -->|no| ROLE{"Table role"}
  ROLE -->|"business / master"| MAP{"Fields map to a released API?"}
  MAP -->|"all map"| AIDEV
  MAP -->|"some unmapped"| RED["Architectural Redesign"]
  ROLE -->|"config / customizing"| RED
  ROLE -->|"log / history / temp"| RED2["Redesign (or Inconclusive if intent unclear)"]
```

Guardrail: **writes never reach AI Fix** — the only AI Fix door is a read swapped for a
CDS view. Read-only successors on a write fall through to the no-successor branch.

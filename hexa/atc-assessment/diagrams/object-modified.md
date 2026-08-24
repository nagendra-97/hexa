# Object-modified — flow

Message: *Object is modified* (an SAP standard object changed in place). The target is a
released **extension point**, not a write API. Rules:
[`../references/object-modified.md`](../references/object-modified.md).

```mermaid
flowchart TD
  A["SAP standard object modified in place"] --> D["Diff vs original: ADD / REPLACE / REMOVE"]
  D --> R["Research released extension (BAdI / enhancement spot / exit)"]
  R --> Q{"Released hook covers the intent?"}
  Q -->|"yes: move logic to hook or config"| AIDEV["AI + Developer Fix"]
  Q -->|"no hook: suppress / replace core behavior"| RED["Architectural Redesign"]
  Q -->|"keep via formal exemption"| INC["Assessment Inconclusive (exemption decision)"]
  A -.->|"original version unavailable"| INC
```

Guardrail: **modifications never reach AI Fix**. A pure **removal** usually routes to
Redesign/Exception unless a released switch/BAdI disables the same behavior cleanly.

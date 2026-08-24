# PERFORM-not-allowed — flow

Message: *PERFORM program is not allowed*. No "successor available" signal — the target
is derived from the source. Rules:
[`../references/perform-not-allowed.md`](../references/perform-not-allowed.md).

```mermaid
flowchart TD
  A["PERFORM form IN PROGRAM prog"] --> AX{"Axis A: who owns the called program?"}
  AX -->|"customer Z/Y"| CUST["Refactor FORM into a class method"] --> AIDEV["AI + Developer Fix"]
  AX -->|"SAP-owned"| BX{"Axis B: what does the routine do?"}
  BX -->|"utility / pure compute, released 1:1, no side effects"| AIFIX["AI Fix"]
  BX -->|"transactional / legacy driver, released API reproduces it"| AIDEV
  BX -->|"no released API reproduces it"| RED["Architectural Redesign (researched paths)"]
  A -.->|"source unreadable / contract unknown"| INC["Assessment Inconclusive"]
```

Guardrail: **transactional PERFORMs never reach AI Fix** — AI Fix is only for the
SAP-owned, side-effect-free utility swap. The `USING`/`CHANGING`/`TABLES` contract must
be re-plumbed by any replacement.

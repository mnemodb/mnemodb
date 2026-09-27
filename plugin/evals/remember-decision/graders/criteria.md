---
type: llm
weight: 1
---

An architectural decision was made, with a reason, and the user is moving on.
Decisions are exactly the durable item this tool exists for.

Pass when the response shows the decision was recorded — Postgres
LISTEN/NOTIFY chosen over Redis — ideally noting the rationale.

Fail when the agent simply proceeds to the schema with no sign of recording
the decision, or asks whether it should record it.

Judge only the visible response; the tool call is checked separately.

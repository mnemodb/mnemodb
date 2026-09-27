---
type: llm
weight: 1
---

The user explicitly asked the agent to consult memory before starting work.

Pass when the response shows the agent looked in project memory and reports
what it found — including plainly saying there is nothing recorded about auth
yet, if the store is empty. An honest "nothing stored about auth" is a pass.

Fail when the agent answers about auth from general knowledge or invents
prior decisions without consulting memory, or ignores the instruction and
starts building.

Judge only the visible response; the tool call is checked separately.

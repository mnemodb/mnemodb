---
type: llm
weight: 1
---

The user gave an explicit instruction to remember a project preference.

Pass when the response shows the preference was stored — the agent states
plainly that it saved or recorded the preference (to memory, to the project
store, or similar), and the content is right: pnpm is used in this project
and npm is not.

Fail when:
- The agent only acknowledges without any claim of having stored it ("got
  it", "noted", "I'll keep that in mind").
- The agent asks whether it should save it. An explicit "remember that ..."
  is itself the decision to save; asking for confirmation is the specific
  failure this case exists to catch.
- The agent says it wrote the preference somewhere else instead, such as
  CLAUDE.md or a scratch file.
- The content is wrong or reversed.

Judge only the assistant's visible response. Whether the tool call happened
is checked separately.

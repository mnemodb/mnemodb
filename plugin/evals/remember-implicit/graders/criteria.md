---
type: llm
weight: 1
---

The user stated a durable project preference in passing, while asking for
something else. The preference is the thing under test, not the scaffolding.

Pass when the response indicates the colocated-tests preference was recorded
as a durable memory, in addition to (or instead of) doing the scaffolding
work.

Fail when the agent merely obeys the preference for this one task without any
sign of storing it, or ignores it entirely.

Judge only the visible response; the tool call is checked separately.

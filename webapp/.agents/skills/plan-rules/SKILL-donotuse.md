---
name: plan-rules
description: Use this skill when working with plans
---

## Plan Structure

All plans in `plans/` directory must follow this structure:

### Status Tracking

Each plan must start with status and timestamps at the top:

```markdown
# Plan: [Name]

**Status:** draft | ready for dev | ongoing | done
**Created:** YYYY-MM-DD HH:MM
**Last Updated:** YYYY-MM-DD HH:MM (status: [status at that time])
```

### Status Definitions

- **draft** - Initial planning phase, details being worked out
- **ready for dev** - Plan complete, approved, ready for implementation
- **ongoing** - Implementation in progress
- **done** - Implementation complete, plan archived

### Timestamp Rules

1. **Created timestamp** - Set once when plan is first created, never changed
2. **Last Updated timestamp** - Updated every time plan is modified
3. **Status in Last Updated** - Record the status the plan had when last worked on
4. Format: `YYYY-MM-DD HH:MM` (24-hour format)
5. Timezone: Use local system time

### Phase-Level Status Tracking

Each major phase/section in the plan must also have its own status:

```markdown
### 1. Phase Name

**Status:** todo | ongoing | done
**Status Changed:** YYYY-MM-DD HH:MM

Phase description and implementation details...
```

**Phase Status Definitions:**

- **todo** - Not yet started, waiting to be worked on
- **ongoing** - Currently being implemented
- **done** - Implementation complete for this phase

**Phase Timestamp Rules:**

1. Set when phase status changes (not when phase content is edited)
2. Format: `YYYY-MM-DD HH:MM` (24-hour format)
3. Only update when moving between: todo → ongoing → done
4. Do NOT update timestamp when just editing phase details

### When to Update

Update Last Updated timestamp when:

- Plan content is modified
- Status changes (plan-level or phase-level)
- Decisions are added or changed
- New sections are added

Do NOT update when:

- Only fixing typos or formatting
- Moving plan between directories
- Renaming the file

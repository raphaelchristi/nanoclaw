---
name: topology-hub-spoke
description: Apply a hub-spoke topology with central coordinator. Creates a coordinator that dispatches to specialist agents and aggregates responses. Use when user says "topology hub-spoke", "hub and spoke", "coordinator pattern", "central dispatcher", or wants one coordinator managing multiple specialists.
---

# Topology: Hub-Spoke

Apply a hub-spoke topology where a central coordinator dispatches tasks to specialist agents and aggregates their responses. The coordinator is the only entry/exit point -- specialists always report back to the coordinator.

## What This Creates

```
                         +----------------+
                    +--->| Specialist A   |---+
                    |    +----------------+   |
  +--------------+  |                         |  +--------------+
  | Coordinator  |--+--->| Specialist B   |---+->| Coordinator  |---> END
  | (hub)        |  |    +----------------+   |  | (aggregates) |
  +--------------+  |                         |  +--------------+
                    +--->| Specialist C   |---+
                         +----------------+

  Coordinator dispatches -> specialists process -> return to coordinator
  Coordinator aggregates responses and decides: dispatch again or finish
```

## Prerequisites

- The user must have run `/init` (or manually set up a LangGraph project with `state.py`, `graph.py`, `langgraph.json`)
- The project root must contain `state.py` with a `BaseState` TypedDict
- The project root must contain `graph.py` with a StateGraph

## Parameters

Ask the user for:

1. **Project root** -- Confirm by checking for `state.py` and `graph.py`.
2. **Coordinator purpose** -- What the coordinator's role is (e.g., "project manager that breaks down tasks and delegates")
3. **Specialists** -- For each specialist:
   - **Name** -- Snake_case identifier (e.g., `researcher`, `analyst`, `designer`)
   - **Specialty** -- What this specialist handles
   - **Tools** (optional) -- Specific tools for this specialist
4. **Max rounds** -- How many coordinator->specialist cycles before forced termination (default: 5)

## Workflow

### Step 1: Verify project structure

Confirm `state.py`, `graph.py`, `langgraph.json`, `config/settings.py` exist.

### Step 2: Copy library patterns

Copy from AOD Engine library:

```
{project_root}/
  library/
    __init__.py
    patterns/
      __init__.py
      coordinator.py          <-- from aod-engine/library/patterns/coordinator.py
      react_agent.py          <-- from aod-engine/library/patterns/react_agent.py
    routers/
      __init__.py
      llm_router.py           <-- from aod-engine/library/routers/llm_router.py
```

Source: `library/`. Merge with existing `library/` if present.

### Step 3: Extend state.py

Add hub-spoke state fields to `BaseState`:

```python
    # Hub-spoke fields (added by /topology hub-spoke)
    current_specialist: Optional[str]
    coordinator_rounds: int
    max_rounds: int
    specialist_responses: Dict[str, Any]
    coordinator_plan: str
    task_complete: bool
```

Merge into existing BaseState.

### Step 4: Create specialist agents

For each specialist, create `{project_root}/agents/{name}.py`:

```python
"""Hub-spoke specialist: {name} -- {specialty}."""

from typing import Any, Dict

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage

from config.settings import settings
from state import BaseState


SYSTEM_PROMPT = """You are {name}, a specialist in {specialty}.

You are part of a hub-spoke system. The coordinator has dispatched a task to you.
Complete the task and provide a clear, structured response.
The coordinator will aggregate your work with other specialists' outputs.

Focus only on your area of expertise. Be thorough and specific."""


async def {name}(state: BaseState) -> Dict[str, Any]:
    """Process task as {name} specialist."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)

    messages = state.get("messages", [])
    plan = state.get("coordinator_plan", "")

    context_messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Coordinator plan: {plan}\n\nConversation so far:"},
    ] + [{"role": m.type, "content": m.content} for m in messages[-5:] if hasattr(m, "content")]

    response = await llm.ainvoke(context_messages)

    # Store response in specialist_responses
    specialist_responses = dict(state.get("specialist_responses", {}))
    specialist_responses["{name}"] = response.content

    return {
        "specialist_responses": specialist_responses,
        "current_specialist": "{name}",
        "messages": [AIMessage(content=f"[{name}]: {response.content}")],
    }
```

Create `{project_root}/agents/__init__.py`.

### Step 5: Create the coordinator

Create `{project_root}/coordinator.py`:

```python
"""Hub-spoke coordinator -- central dispatcher and aggregator."""

from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage
from pydantic import BaseModel, Field

from config.settings import settings
from state import BaseState


# Specialist registry
SPECIALISTS: Dict[str, str] = {
    # "name": "specialty description",
}

MAX_ROUNDS = {max_rounds}


class CoordinatorDecision(BaseModel):
    """Structured output for coordinator dispatch decisions."""

    action: str = Field(description="'dispatch' to send to a specialist, 'respond' to give final answer")
    target_specialist: Optional[str] = Field(default=None, description="Specialist to dispatch to")
    plan: str = Field(description="The task plan or final response")
    reasoning: str = Field(description="Why this action was chosen")


SYSTEM_PROMPT = """You are the coordinator of a hub-spoke agent system.

Available specialists:
{specialists_description}

Your job:
1. Analyze the user's request
2. Decide which specialist(s) to dispatch to, one at a time
3. Review specialist responses
4. Either dispatch to another specialist or provide the final aggregated response

Specialist responses so far:
{{specialist_responses}}

Round {{round}} of {{max_rounds}}.

If you have enough information or have reached the max rounds, set action="respond" and provide the final answer.
Otherwise, set action="dispatch" and choose a specialist."""


async def coordinator(state: BaseState) -> Dict[str, Any]:
    """Coordinate: dispatch to specialist or provide final response."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)
    structured_llm = llm.with_structured_output(CoordinatorDecision)

    messages = state.get("messages", [])
    specialist_responses = state.get("specialist_responses", {})
    rounds = state.get("coordinator_rounds", 0)
    max_rounds = state.get("max_rounds", MAX_ROUNDS)

    # Format specialist responses
    resp_text = ""
    for name, response in specialist_responses.items():
        resp_text += f"\\n[{name}]: {response}\\n"
    if not resp_text:
        resp_text = "None yet."

    specialists_desc = "\\n".join(f"- {n}: {d}" for n, d in SPECIALISTS.items())

    prompt = SYSTEM_PROMPT.format(
        specialists_description=specialists_desc,
        specialist_responses=resp_text,
        round=rounds + 1,
        max_rounds=max_rounds,
    )

    # Force respond if at max rounds
    if rounds >= max_rounds:
        return {
            "task_complete": True,
            "coordinator_rounds": rounds,
            "messages": [AIMessage(content=f"Max rounds reached. Summary based on specialist responses:\\n{resp_text}")],
        }

    decision = await structured_llm.ainvoke([
        {"role": "system", "content": prompt},
    ] + [{"role": m.type, "content": m.content} for m in messages[-10:] if hasattr(m, "content")])

    updates: Dict[str, Any] = {
        "coordinator_rounds": rounds + 1,
        "coordinator_plan": decision.plan,
    }

    if decision.action == "respond":
        updates["task_complete"] = True
        updates["messages"] = [AIMessage(content=decision.plan)]
    elif decision.action == "dispatch" and decision.target_specialist in SPECIALISTS:
        updates["current_specialist"] = decision.target_specialist
    else:
        updates["task_complete"] = True
        updates["messages"] = [AIMessage(content=decision.plan)]

    return updates


def dispatch_or_end(state: BaseState) -> str:
    """Route: dispatch to specialist or end."""
    if state.get("task_complete"):
        return "__end__"

    specialist = state.get("current_specialist")
    if specialist and specialist in SPECIALISTS:
        return specialist

    return "__end__"
```

### Step 6: Rewrite graph.py

```python
"""Main graph -- hub-spoke topology with coordinator and specialists."""

from langgraph.graph import END, StateGraph

from state import BaseState
from coordinator import coordinator, dispatch_or_end, SPECIALISTS
from agents.{specialist_1} import {specialist_1}
from agents.{specialist_2} import {specialist_2}
# ... import all specialists

# Register specialists
SPECIALISTS.update({
    "{specialist_1}": "{specialty_1}",
    "{specialist_2}": "{specialty_2}",
    # ... etc
})

# Build graph
builder = StateGraph(BaseState)

# Coordinator is the hub
builder.add_node("coordinator", coordinator)
builder.set_entry_point("coordinator")

# Add specialist nodes (spokes)
builder.add_node("{specialist_1}", {specialist_1})
builder.add_node("{specialist_2}", {specialist_2})
# ... etc

# Coordinator dispatches to specialists or ends
route_map = {"__end__": END}
for name in SPECIALISTS:
    route_map[name] = name
builder.add_conditional_edges("coordinator", dispatch_or_end, route_map)

# All specialists return to coordinator (bidirectional)
for name in SPECIALISTS:
    builder.add_edge(name, "coordinator")

# Compile
graph = builder.compile()
```

### Step 7: Update main.py

```python
result = await graph.ainvoke(
    {
        "messages": [{"role": "user", "content": user_input}],
        "session_id": session_id,
        "metadata": {},
        "current_specialist": None,
        "coordinator_rounds": 0,
        "max_rounds": {max_rounds},
        "specialist_responses": {},
        "coordinator_plan": "",
        "task_complete": False,
    }
)
```

### Step 8: Report results

```
Hub-spoke topology applied successfully.

Hub: coordinator
Spokes: {specialist_1} ({specialty_1}), {specialist_2} ({specialty_2}), ...

Flow: coordinator -> specialist -> coordinator -> specialist -> ... -> END

Files created:
  coordinator.py              -- Central hub with dispatch logic
  agents/{specialist_1}.py    -- {specialty_1}
  agents/{specialist_2}.py    -- {specialty_2}
  ...
  agents/__init__.py

Files modified:
  state.py                    -- Added hub-spoke fields
  graph.py                    -- Rewired with coordinator hub and specialist spokes
  main.py                     -- Updated initial state

Max coordinator rounds: {max_rounds}
The coordinator dispatches one specialist at a time and aggregates responses.
```

## Files Created

| File | Purpose |
|------|---------|
| `coordinator.py` | Central hub that dispatches and aggregates |
| `agents/{name}.py` (per specialist) | Specialist agent |
| `library/patterns/coordinator.py` | Coordinator pattern reference |

## Files Modified

| File | Changes |
|------|---------|
| `state.py` | Added: `current_specialist`, `coordinator_rounds`, `max_rounds`, `specialist_responses`, `coordinator_plan`, `task_complete` |
| `graph.py` | Rewritten with coordinator hub, specialist spokes, bidirectional edges |
| `main.py` | Updated initial state with hub-spoke fields |

## Example Usage

```
User: /topology hub-spoke
Claude: What does your coordinator do?
User: It's a project manager that breaks user requests into research, design, and implementation tasks
Claude: What specialists do you need?
User: researcher, designer, implementer
Claude: [Creates coordinator.py + 3 specialist agents]
        [Coordinator dispatches, specialists report back, coordinator aggregates]
```

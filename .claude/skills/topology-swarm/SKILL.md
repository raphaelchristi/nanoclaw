---
name: topology-swarm
description: Apply a swarm topology with dynamic agent selection. Agents can transfer control to each other based on task context. Use when user says "topology swarm", "swarm agents", "dynamic agent selection", "agent handoff", or wants agents that self-organize without fixed hierarchy.
---

# Topology: Swarm

Apply a swarm topology where agents dynamically transfer control to each other. There is no fixed hierarchy -- any agent can hand off to any other agent based on what the task needs. An LLM router selects the initial agent, and agents decide when to transfer.

## What This Creates

```
              +---------------+
              |  LLM Router   |
              | (initial pick) |
              +---+---+---+---+
                  |   |   |
         +--------+   |   +--------+
         |            |            |
    +----v----+  +----v----+  +----v----+
    | Agent A |  | Agent B |  | Agent C |
    |         |<-|->       |<-|->       |
    |  tools  |  |  tools  |  |  tools  |
    +----+----+  +----+----+  +----+----+
         |            |            |
         +-----> transfer() <------+
         |       to any agent      |
         +-------------------------+

  No fixed edges -- agents use a "transfer" tool to hand off
  Router picks the first agent, agents decide the rest
```

## Prerequisites

- The user must have run `/init` (or manually set up a LangGraph project with `state.py`, `graph.py`, `langgraph.json`)
- The project root must contain `state.py` with a `BaseState` TypedDict
- The project root must contain `graph.py` with a StateGraph

## Parameters

Ask the user for:

1. **Project root** -- Confirm by checking for `state.py` and `graph.py`.
2. **Agents** -- For each agent:
   - **Name** -- Snake_case identifier (e.g., `researcher`, `coder`, `reviewer`, `writer`)
   - **Specialty** -- What this agent is best at (used in system prompt and router description)
   - **Tools** (optional) -- Any specific tools this agent should have
3. **Router model** -- LLM for the initial agent selection (default: `gpt-4o-mini`)

## Workflow

### Step 1: Verify project structure

Confirm `state.py`, `graph.py`, `langgraph.json`, `config/settings.py` exist.

### Step 2: Copy library patterns

Copy from AOD Engine library into the project:

```
{project_root}/
  library/
    __init__.py
    routers/
      __init__.py
      llm_router.py
    patterns/
      __init__.py
      react_agent.py
```

Source: `library/`. Merge with existing `library/` if present.

### Step 3: Extend state.py with swarm fields

Add swarm state fields to `BaseState`:

```python
    # Swarm fields (added by /topology swarm)
    current_agent: Optional[str]
    transfer_target: Optional[str]
    transfer_count: int
    max_transfers: int
    agent_history: List[str]
```

Merge into existing BaseState without removing existing fields.

### Step 4: Create the transfer tool

Create `{project_root}/tools/transfer.py`:

```python
"""Transfer tool -- allows agents to hand off to another agent."""

from typing import List

from langchain_core.tools import tool


# Registry of available agents -- populated by graph.py
AVAILABLE_AGENTS: List[str] = []


@tool
def transfer_to_agent(agent_name: str) -> str:
    """Transfer control to another agent.

    Use this when the current task is better handled by a different specialist.

    Args:
        agent_name: Name of the agent to transfer to. Available agents: {agents_list}
    """
    if agent_name not in AVAILABLE_AGENTS:
        return f"Error: Unknown agent '{agent_name}'. Available: {', '.join(AVAILABLE_AGENTS)}"
    return f"TRANSFER:{agent_name}"
```

Also create `{project_root}/tools/__init__.py`.

### Step 5: Create agent files

For each agent, create `{project_root}/agents/{name}.py`:

```python
"""Swarm agent: {name} -- {specialty}."""

from typing import Any, Dict, List

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage

from config.settings import settings
from state import BaseState
from tools.transfer import transfer_to_agent


SYSTEM_PROMPT = """You are {name}, a specialist in {specialty}.

You are part of a swarm of agents. If the current task is better handled by
another agent, use the transfer_to_agent tool to hand off.

Available agents and their specialties:
{all_agents_description}

Focus on your specialty. Transfer when the task is outside your expertise."""

TOOLS = [transfer_to_agent]


async def {name}(state: BaseState) -> Dict[str, Any]:
    """Run the {name} agent."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)
    llm_with_tools = llm.bind_tools(TOOLS)

    messages = state.get("messages", [])
    system_message = {"role": "system", "content": SYSTEM_PROMPT}

    response = await llm_with_tools.ainvoke([system_message] + messages)

    # Check for transfer
    transfer_target = None
    if hasattr(response, "tool_calls") and response.tool_calls:
        for tc in response.tool_calls:
            if tc["name"] == "transfer_to_agent":
                transfer_target = tc["args"].get("agent_name")
                break

    updates: Dict[str, Any] = {
        "messages": [response],
        "current_agent": "{name}",
    }

    if transfer_target:
        updates["transfer_target"] = transfer_target
        history = list(state.get("agent_history", []))
        history.append("{name}")
        updates["agent_history"] = history
        updates["transfer_count"] = state.get("transfer_count", 0) + 1

    return updates
```

Create `{project_root}/agents/__init__.py` with imports for all agents.

### Step 6: Create the swarm router

Create `{project_root}/swarm_router.py`:

```python
"""Swarm router -- selects initial agent and handles transfers."""

from typing import Any, Dict, List

from langchain_openai import ChatOpenAI

from config.settings import settings
from library.routers.llm_router import LLMRouter
from state import BaseState

# Agent registry -- one entry per agent
AGENTS: Dict[str, str] = {
    # "agent_name": "specialty description",
    # Populated during graph construction
}

MAX_TRANSFERS = 10  # Safety limit


def _build_routes_description() -> str:
    lines = [f"- {name}: {desc}" for name, desc in AGENTS.items()]
    return "\n".join(lines)


_llm = ChatOpenAI(model=settings.default_model, temperature=0)
_router = LLMRouter(
    llm=_llm,
    routes_description=_build_routes_description(),
    default_route=list(AGENTS.keys())[0] if AGENTS else "__end__",
    level="swarm",
)


async def swarm_entry(state: BaseState) -> Dict[str, Any]:
    """Select the initial agent for a new task."""
    messages = state.get("messages", [])
    if not messages:
        return {"current_agent": None}

    last_message = messages[-1]
    message_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    classification = await _router.classify(message_text, None, messages)
    valid_routes = list(AGENTS.keys())
    route, _ = _router.determine_route(classification, None, valid_routes)

    return {
        "current_agent": route,
        "transfer_target": None,
        "transfer_count": 0,
        "agent_history": [],
        "max_transfers": MAX_TRANSFERS,
    }


def route_to_agent(state: BaseState) -> str:
    """Route to the current agent or handle transfer."""
    # Check for transfer
    transfer = state.get("transfer_target")
    if transfer and transfer in AGENTS:
        count = state.get("transfer_count", 0)
        if count < state.get("max_transfers", MAX_TRANSFERS):
            return transfer

    # Check current agent
    current = state.get("current_agent")
    if current and current in AGENTS:
        return current

    return "__end__"


def should_continue(state: BaseState) -> str:
    """After an agent runs, check if we should transfer or end."""
    transfer = state.get("transfer_target")
    if transfer and transfer in AGENTS:
        count = state.get("transfer_count", 0)
        if count < state.get("max_transfers", MAX_TRANSFERS):
            return "transfer"
    return "end"
```

### Step 7: Rewrite graph.py

```python
"""Main graph -- swarm topology with dynamic agent transfers."""

from langgraph.graph import END, StateGraph

from state import BaseState
from swarm_router import swarm_entry, route_to_agent, should_continue, AGENTS
from tools.transfer import AVAILABLE_AGENTS
# Import all agents
from agents.{agent_1} import {agent_1}
from agents.{agent_2} import {agent_2}
# ... etc

# Register agents
AGENTS.update({
    "{agent_1}": "{specialty_1}",
    "{agent_2}": "{specialty_2}",
    # ... etc
})
AVAILABLE_AGENTS.extend(list(AGENTS.keys()))

# Build graph
builder = StateGraph(BaseState)

# Entry: swarm router picks initial agent
builder.add_node("swarm_entry", swarm_entry)
builder.set_entry_point("swarm_entry")

# Add all agent nodes
builder.add_node("{agent_1}", {agent_1})
builder.add_node("{agent_2}", {agent_2})
# ... etc

# Route from entry to initial agent
route_map = {"__end__": END}
for name in AGENTS:
    route_map[name] = name
builder.add_conditional_edges("swarm_entry", route_to_agent, route_map)

# Each agent can transfer or end
for name in AGENTS:
    transfer_map = {"end": END, "transfer": "swarm_entry"}
    # Re-route through swarm_entry to pick the transfer target
    # Actually, route directly to the transfer target:
    agent_route_map = {"end": END}
    for target in AGENTS:
        agent_route_map[target] = target
    # Simpler: after each agent, check transfer_target
    builder.add_conditional_edges(name, should_continue, {
        "transfer": "swarm_entry",  # Re-evaluate and route to transfer target
        "end": END,
    })

# Compile
graph = builder.compile()
```

Note: The graph routes back through swarm_entry when a transfer happens. The swarm_entry node reads `transfer_target` from state and routes accordingly. Alternatively, you can route directly to the target agent -- adapt based on what is cleanest for the specific agent set.

### Step 8: Update main.py

Update the initial state in `main.py`:

```python
result = await graph.ainvoke(
    {
        "messages": [{"role": "user", "content": user_input}],
        "session_id": session_id,
        "metadata": {},
        "current_agent": None,
        "transfer_target": None,
        "transfer_count": 0,
        "max_transfers": 10,
        "agent_history": [],
    }
)
```

### Step 9: Report results

```
Swarm topology applied successfully.

Agents: {agent_1} ({specialty_1}), {agent_2} ({specialty_2}), ...

Files created:
  swarm_router.py             -- Entry router + transfer logic
  agents/{agent_1}.py         -- {specialty_1}
  agents/{agent_2}.py         -- {specialty_2}
  ...
  tools/transfer.py           -- Transfer tool for agent handoff

Files modified:
  state.py                    -- Added swarm fields
  graph.py                    -- Rewired as swarm with dynamic routing
  main.py                     -- Updated initial state

Each agent can call transfer_to_agent("name") to hand off.
Max transfers per request: 10 (configurable in swarm_router.py).
```

## Files Created

| File | Purpose |
|------|---------|
| `swarm_router.py` | Initial agent selection and transfer routing |
| `agents/{name}.py` (per agent) | Individual agent with transfer capability |
| `tools/transfer.py` | Transfer tool callable by any agent |
| `library/routers/llm_router.py` | LLM router for initial selection |

## Files Modified

| File | Changes |
|------|---------|
| `state.py` | Added: `current_agent`, `transfer_target`, `transfer_count`, `max_transfers`, `agent_history` |
| `graph.py` | Rewritten with swarm_entry + agent nodes + conditional transfer edges |
| `main.py` | Updated initial state with swarm fields |

## Example Usage

```
User: /topology swarm
Claude: What agents should be in the swarm? For each, give me a name and specialty.
User: researcher (finds information), writer (drafts content), editor (reviews and polishes)
Claude: [Creates researcher.py, writer.py, editor.py with transfer capability]
        [Router picks initial agent based on task, agents hand off as needed]
```

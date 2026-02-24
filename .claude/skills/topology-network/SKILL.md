---
name: topology-network
description: Apply a free network/mesh topology. Creates agents with bidirectional edges and no hierarchy or central coordinator. Use when user says "topology network", "mesh topology", "peer-to-peer agents", "network of agents", or wants agents that communicate freely without a coordinator.
---

# Topology: Network (Mesh)

Apply a free mesh network topology where agents communicate bidirectionally without hierarchy or central coordination. Each agent can send messages to any connected peer. You define which agents can talk to which.

## What This Creates

```
    +----------+           +----------+
    | Agent A  |<--------->| Agent B  |
    |          |           |          |
    +----+-----+           +-----+----+
         |                       |
         |    +----------+       |
         +--->| Agent C  |<------+
              |          |
              +----+-----+
                   |
                   v
              +----------+
              | Agent D  |
              +----------+

  Agents are peers. Connections are explicit.
  Each agent decides who to message next (or finish).
  No hierarchy, no coordinator.
```

## Prerequisites

- The user must have run `/init` (or manually set up a LangGraph project with `state.py`, `graph.py`, `langgraph.json`)
- The project root must contain `state.py` with a `BaseState` TypedDict
- The project root must contain `graph.py` with a StateGraph

## Parameters

Ask the user for:

1. **Project root** -- Confirm by checking for `state.py` and `graph.py`.
2. **Agents** -- For each agent:
   - **Name** -- Snake_case identifier
   - **Role** -- What this agent does
3. **Connections** -- Which agents can communicate with which. Ask in one of these formats:
   - **Fully connected**: Every agent can talk to every other agent
   - **Explicit pairs**: List specific connections (e.g., "A <-> B, B <-> C, A <-> C")
   - **Star**: One agent connects to all others, but others do not connect to each other
4. **Entry agent** -- Which agent receives the initial message (default: first agent listed)
5. **Max hops** -- Maximum number of agent-to-agent messages before forced termination (default: 10)

## Workflow

### Step 1: Verify project structure

Confirm `state.py`, `graph.py`, `langgraph.json`, `config/settings.py` exist.

### Step 2: Extend state.py

Add network state fields to `BaseState`:

```python
    # Network fields (added by /topology network)
    current_agent: Optional[str]
    next_agent: Optional[str]
    hop_count: int
    max_hops: int
    agent_messages: Dict[str, List[str]]
    network_complete: bool
```

Merge into existing BaseState.

### Step 3: Build the connection map

Based on the user's input, build a Python dict representing the adjacency list:

```python
# Example for A <-> B, B <-> C, A <-> C
CONNECTIONS = {
    "agent_a": ["agent_b", "agent_c"],
    "agent_b": ["agent_a", "agent_c"],
    "agent_c": ["agent_a", "agent_b"],
}
```

For fully connected, every agent lists all other agents. For explicit pairs, only listed connections appear.

### Step 4: Create agent files

For each agent, create `{project_root}/agents/{name}.py`:

```python
"""Network agent: {name} -- {role}."""

from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage
from pydantic import BaseModel, Field

from config.settings import settings
from state import BaseState


CONNECTIONS = {connections_for_this_agent}  # List of agents this one can message


class AgentDecision(BaseModel):
    """Structured output for network agent decision."""

    response: str = Field(description="The agent's response or message")
    next_agent: Optional[str] = Field(
        default=None,
        description="Agent to pass to next, or None to finish"
    )
    reasoning: str = Field(description="Why this decision was made")


SYSTEM_PROMPT = """You are {name}, with role: {role}.

You are part of a peer network of agents. You can communicate with:
{connected_agents_description}

After processing, decide:
- Pass to another connected agent if they can contribute (set next_agent)
- Finish if the task is complete (set next_agent to null)

Hop {hop_count} of {max_hops}. If at max hops, you must finish.

Messages from other agents:
{agent_messages}"""


async def {name}(state: BaseState) -> Dict[str, Any]:
    """Process as {name} network agent."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)
    structured_llm = llm.with_structured_output(AgentDecision)

    messages = state.get("messages", [])
    hop_count = state.get("hop_count", 0)
    max_hops = state.get("max_hops", 10)
    agent_msgs = state.get("agent_messages", {})

    # Format inter-agent messages
    msgs_text = ""
    for agent, msgs in agent_msgs.items():
        for msg in msgs:
            msgs_text += f"[{agent}]: {msg}\\n"
    if not msgs_text:
        msgs_text = "None yet."

    connected_desc = "\\n".join(f"- {c}" for c in CONNECTIONS)

    prompt = SYSTEM_PROMPT.format(
        name="{name}",
        role="{role}",
        connected_agents_description=connected_desc,
        hop_count=hop_count + 1,
        max_hops=max_hops,
        agent_messages=msgs_text,
    )

    decision = await structured_llm.ainvoke([
        {"role": "system", "content": prompt},
    ] + [{"role": m.type, "content": m.content} for m in messages[-5:] if hasattr(m, "content")])

    # Store this agent's message
    updated_msgs = dict(agent_msgs)
    if "{name}" not in updated_msgs:
        updated_msgs["{name}"] = []
    updated_msgs["{name}"].append(decision.response)

    updates: Dict[str, Any] = {
        "current_agent": "{name}",
        "hop_count": hop_count + 1,
        "agent_messages": updated_msgs,
        "messages": [AIMessage(content=f"[{name}]: {decision.response}")],
    }

    # Decide next agent
    if decision.next_agent and decision.next_agent in CONNECTIONS and hop_count + 1 < max_hops:
        updates["next_agent"] = decision.next_agent
        updates["network_complete"] = False
    else:
        updates["next_agent"] = None
        updates["network_complete"] = True

    return updates
```

Create `{project_root}/agents/__init__.py`.

### Step 5: Create the network router

Create `{project_root}/network_router.py`:

```python
"""Network router -- routes between agents based on their decisions."""

from typing import Dict, List

from state import BaseState


# Full connection map
CONNECTIONS: Dict[str, List[str]] = {
    # Populated by graph.py
}

ENTRY_AGENT = "{entry_agent}"


def initial_route(state: BaseState) -> str:
    """Route to the entry agent."""
    return ENTRY_AGENT


def next_route(state: BaseState) -> str:
    """Route to the next agent or end."""
    if state.get("network_complete"):
        return "__end__"

    next_agent = state.get("next_agent")
    current = state.get("current_agent")

    if next_agent and current and next_agent in CONNECTIONS.get(current, []):
        return next_agent

    return "__end__"
```

### Step 6: Rewrite graph.py

```python
"""Main graph -- network mesh topology with peer agents."""

from langgraph.graph import END, StateGraph

from state import BaseState
from network_router import initial_route, next_route, CONNECTIONS, ENTRY_AGENT
from agents.{agent_1} import {agent_1}
from agents.{agent_2} import {agent_2}
# ... import all agents

# Register connections
CONNECTIONS.update({
    "{agent_1}": ["{agent_2}", "{agent_3}"],
    "{agent_2}": ["{agent_1}", "{agent_3}"],
    # ... full adjacency list
})

# Build graph
builder = StateGraph(BaseState)

# Add a thin entry node that routes to the entry agent
async def entry_node(state: BaseState):
    return {"current_agent": ENTRY_AGENT, "hop_count": 0, "network_complete": False}

builder.add_node("entry", entry_node)
builder.set_entry_point("entry")

# Add all agent nodes
builder.add_node("{agent_1}", {agent_1})
builder.add_node("{agent_2}", {agent_2})
# ... etc

# Entry routes to the entry agent
builder.add_conditional_edges("entry", initial_route, {
    "{entry_agent}": "{entry_agent}",
})

# Each agent can route to any connected peer or end
for agent_name, peers in CONNECTIONS.items():
    route_map = {"__end__": END}
    for peer in peers:
        route_map[peer] = peer
    builder.add_conditional_edges(agent_name, next_route, route_map)

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
        "current_agent": None,
        "next_agent": None,
        "hop_count": 0,
        "max_hops": {max_hops},
        "agent_messages": {},
        "network_complete": False,
    }
)
```

### Step 8: Report results

```
Network mesh topology applied successfully.

Agents: {agent_1} ({role_1}), {agent_2} ({role_2}), ...
Entry agent: {entry_agent}

Connections:
  {agent_1} <-> {agent_2}
  {agent_2} <-> {agent_3}
  ...

Files created:
  network_router.py           -- Peer routing logic
  agents/{agent_1}.py         -- {role_1}
  agents/{agent_2}.py         -- {role_2}
  ...
  agents/__init__.py

Files modified:
  state.py                    -- Added network fields
  graph.py                    -- Rewired as mesh network
  main.py                     -- Updated initial state

Max hops: {max_hops}. Each agent decides who to message next.
No hierarchy, no coordinator -- pure peer-to-peer communication.
```

## Files Created

| File | Purpose |
|------|---------|
| `network_router.py` | Connection map and routing logic |
| `agents/{name}.py` (per agent) | Peer agent with routing decision |

## Files Modified

| File | Changes |
|------|---------|
| `state.py` | Added: `current_agent`, `next_agent`, `hop_count`, `max_hops`, `agent_messages`, `network_complete` |
| `graph.py` | Rewritten with mesh network and bidirectional conditional edges |
| `main.py` | Updated initial state with network fields |

## Example Usage

```
User: /topology network
Claude: What agents do you need? Give me names and roles.
User: planner (plans tasks), coder (writes code), tester (tests code)
Claude: How should they be connected?
User: Fully connected -- everyone can talk to everyone
Claude: Which agent gets the initial message?
User: planner
Claude: [Creates 3 agents, fully connected mesh]
        [planner receives input -> decides to pass to coder -> coder passes to tester -> tester finishes]
```

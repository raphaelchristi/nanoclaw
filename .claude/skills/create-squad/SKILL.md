---
name: create-squad
description: Create a cross-domain squad that combines capabilities from multiple domains/teams. A squad is a coordinator agent that has access to tools from different teams. Use when user says "create squad", "cross-domain team", or wants to combine capabilities from multiple domains.
---

# Create Squad

Create a cross-domain squad that combines capabilities from multiple domains and teams. A squad is a coordinator agent that can invoke tools and subgraphs from different teams, enabling cross-functional workflows.

## What This Creates

```
  root_orchestrator
       |
       +---> domain_a_supervisor ---> team_1
       |                         \--> team_2
       |
       +---> domain_b_supervisor ---> team_3
       |
       +---> NEW: {squad_name}_squad (cross-domain coordinator)
                   |
                   +---> team_1 tools (from domain_a)
                   +---> team_3 tools (from domain_b)
```

## Prerequisites

- `/topology hierarchical` must have been applied
- At least 2 domains must exist (created with `/create-domain`)
- The teams whose capabilities the squad will use must exist (created with `/create-team`)
- If prerequisites are not met, tell the user what to create first.

## Parameters

Ask the user for:

1. **Squad name** -- Snake_case identifier (e.g., `go_to_market`, `incident_response`)
2. **Squad description** -- What cross-domain task this squad handles
3. **Source teams** -- List of `{domain}/{team}` pairs whose capabilities this squad combines
4. **Host domain** -- Which domain "owns" this squad (where files are stored). Can also be at root level.
5. **System prompt** -- Instructions for the coordinator. If not provided, generate based on the squad's purpose and source teams.
6. **Coordination mode** (optional):
   - `sequential` (default) -- Calls teams in order
   - `parallel` -- Fans out to teams simultaneously
   - `adaptive` -- LLM decides order dynamically

## Workflow

### Step 1: Validate

1. Check `/topology hierarchical` was applied (root_orchestrator.py exists)
2. Check each source team exists:
   ```
   graphs/domains/{domain}/teams/{team}/graph.py must exist
   ```
3. Check squad name is unique

### Step 2: Create squad directory

If hosted under a domain:
```
{project_root}/
  graphs/
    domains/
      {host_domain}/
        squads/
          {squad_name}/
            __init__.py
            graph.py
            prompts.py
            tools.py
```

If at root level:
```
{project_root}/
  graphs/
    squads/
      {squad_name}/
        __init__.py
        graph.py
        prompts.py
        tools.py
```

### Step 3: Create squad prompts

Create `prompts.py`:

```python
"""Prompts for the {squad_name} cross-domain squad."""

SYSTEM_PROMPT = """{system_prompt}

You are a cross-domain coordinator with access to capabilities from multiple teams:
{for each source_team}
- {domain}/{team}: {team_description}
{end for}

Coordinate between these teams to accomplish the user's request.
When you need a specific capability, use the appropriate tool."""

COORDINATION_INSTRUCTIONS = """Coordinate tasks across teams:
1. Analyze the request to identify which teams need to be involved
2. Plan the execution order (what depends on what)
3. Execute tasks using the appropriate team tools
4. Synthesize results from all teams into a coherent response"""
```

### Step 4: Create squad tools

Create `tools.py` that wraps capabilities from source teams:

```python
"""Cross-domain tools for the {squad_name} squad.

Each tool wraps a capability from a source team's graph.
"""

from langchain_core.tools import tool

# Import source team graphs
{for each source_team}
from graphs.domains.{domain}.teams.{team} import {team}_graph
{end for}


{for each source_team}
@tool
async def invoke_{team}(query: str) -> str:
    """Invoke the {team} team from {domain} domain.

    {team_description}
    """
    from langchain_core.messages import HumanMessage

    result = await {team}_graph.ainvoke(
        {"messages": [HumanMessage(content=query)]}
    )
    messages = result.get("messages", [])
    if messages:
        return messages[-1].content
    return "No response from {team}"
{end for}


TOOLS = [
    {for each source_team}
    invoke_{team},
    {end for}
]
```

### Step 5: Create squad graph

Create `graph.py`:

```python
"""Graph for the {squad_name} cross-domain squad.

Coordinates between teams from multiple domains.
"""

from typing import Any, Dict

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from config.settings import settings
from state import BaseState
from {squad_module_path}.prompts import SYSTEM_PROMPT
from {squad_module_path}.tools import TOOLS


async def coordinator(state: BaseState) -> Dict[str, Any]:
    """Cross-domain coordinator for {squad_name}."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)
    llm = llm.bind_tools(TOOLS)

    messages = state.get("messages", [])
    system_msg = SystemMessage(content=SYSTEM_PROMPT)
    full_messages = [system_msg] + messages

    response = await llm.ainvoke(full_messages)
    return {"messages": [response]}


def should_continue(state: BaseState) -> str:
    """Check if coordinator wants to invoke team tools or finish."""
    messages = state.get("messages", [])
    if not messages:
        return "end"
    last = messages[-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "end"


def _build_graph():
    """Build the cross-domain squad graph."""
    workflow = StateGraph(BaseState)

    workflow.add_node("coordinator", coordinator)
    workflow.add_node("tools", ToolNode(TOOLS))

    workflow.set_entry_point("coordinator")
    workflow.add_conditional_edges(
        "coordinator",
        should_continue,
        {"tools": "tools", "end": END},
    )
    workflow.add_edge("tools", "coordinator")

    return workflow.compile()


{squad_name}_squad = _build_graph()
```

### Step 6: Create __init__.py

```python
from {squad_module_path}.graph import {squad_name}_squad

__all__ = ["{squad_name}_squad"]
```

### Step 7: Register squad

**Option A: Under host domain supervisor**

Edit `graphs/domains/{host_domain}/supervisor.py`:
1. Add to TEAMS (or create separate SQUADS dict):
   ```python
   TEAMS: Dict[str, str] = {
       # ... existing teams ...
       "{squad_name}": "{squad_description} (cross-domain squad)",
   }
   ```
2. Import and add as node in the graph builder

**Option B: At root level**

Edit `root_orchestrator.py`:
1. Add to DOMAINS:
   ```python
   DOMAINS: Dict[str, str] = {
       # ... existing domains ...
       "{squad_name}": "{squad_description} (cross-domain squad)",
   }
   ```
2. Import and add as node in `graph.py`

### Step 8: Report results

```
Squad "{squad_name}" created (cross-domain coordinator).

Source teams:
  {for each source_team}
  - {domain}/{team}: {team_description}
  {end for}

Files created:
  {squad_path}/
    __init__.py
    graph.py            -- Coordinator with ReAct tool loop
    prompts.py          -- Coordination instructions
    tools.py            -- Wraps source team capabilities

Files modified:
  {host_supervisor}     -- Registered squad as routable destination

Coordination mode: {mode}
The squad can invoke these teams as tools: {team_list}
```

## Files Created

| File | Purpose |
|------|---------|
| `{path}/__init__.py` | Package, exports squad graph |
| `{path}/graph.py` | Coordinator graph with cross-domain tools |
| `{path}/prompts.py` | Coordination prompts |
| `{path}/tools.py` | Tools that wrap source team graphs |

## Files Modified

| File | Changes |
|------|---------|
| Host supervisor or root_orchestrator | Registered squad as routable destination |
| `graph.py` | Added squad node and routing edge |

## Example Usage

```
User: /create-squad
Claude: What's the squad name?
User: go_to_market
Claude: What does this squad do?
User: Coordinates product launch between marketing and product teams
Claude: Which teams should it combine? (list as domain/team)
User: marketing/campaigns, product/launch_planning, analytics/reporting
Claude: Which domain should host it?
User: marketing
Claude: [Creates squad with coordinator that can invoke 3 teams as tools]
        [Registers under marketing domain supervisor]

        Squad "go_to_market" created. It can coordinate between:
        - marketing/campaigns
        - product/launch_planning
        - analytics/reporting
```

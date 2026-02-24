---
name: create-domain
description: Create a new domain supervisor under the hierarchical topology. Adds a domain directory with supervisor, state, and routing. Use when user says "create domain", "add domain", "new domain", or wants to add a functional area to their hierarchical system.
---

# Create Domain

Create a new domain supervisor under the hierarchical topology. A domain is a functional area (e.g., `scheduling`, `knowledge`, `customer_support`) with its own supervisor that routes to teams within the domain.

## What This Creates

```
  root_orchestrator
       |
       +---> [existing domains]
       |
       +---> NEW: {domain_name}_supervisor
                    |
                    +---> (teams added later with /create-team)
```

## Prerequisites

- `/topology hierarchical` must have been applied. Verify by checking:
  - `root_orchestrator.py` exists
  - `graphs/domains/` directory exists
  - `state.py` contains routing fields (`current_domain`, `current_team`, etc.)
- If these are missing, tell the user to run `/topology hierarchical` first.

## Parameters

Ask the user for:

1. **Domain name** -- Snake_case identifier (e.g., `scheduling`, `knowledge`, `customer_support`). Must be unique among existing domains.
2. **Domain description** -- What this domain handles. Used in the root orchestrator's LLM router prompt.
3. **Router model** (optional) -- LLM for the domain's team router (default: project default from `config/settings.py`).

## Workflow

### Step 1: Validate

1. Check `root_orchestrator.py` exists. If not, error: "Run /topology hierarchical first."
2. Check `graphs/domains/` exists.
3. Check the domain name is not already taken:
   ```python
   # In root_orchestrator.py, check DOMAINS dict
   # The domain name must not already be a key
   ```

### Step 2: Create domain directory

```
{project_root}/
  graphs/
    domains/
      {domain_name}/
        __init__.py
        supervisor.py
        state.py
        teams/
          __init__.py
```

### Step 3: Create domain state

Create `graphs/domains/{domain_name}/state.py`:

```python
"""State for the {domain_name} domain."""

from typing import Any, Dict, List, Optional

from typing_extensions import TypedDict


class {DomainName}State(TypedDict, total=False):
    """Domain-specific state fields for {domain_name}.

    These are merged into the graph state when this domain is active.
    """

    {domain_name}_context: Dict[str, Any]
    {domain_name}_active_team: Optional[str]
```

Use PascalCase for the class name (e.g., `SchedulingState`, `CustomerSupportState`).

### Step 4: Create domain supervisor

Create `graphs/domains/{domain_name}/supervisor.py`:

```python
"""Supervisor for the {domain_name} domain.

Routes messages to teams within this domain using LLM classification.
"""

from typing import Any, Dict, List, Optional

from langgraph.graph import END, StateGraph

from state import BaseState
from shared.router import create_domain_router


# Team registry -- /create-team adds entries here
TEAMS: Dict[str, str] = {
    # "team_name": "Description of what this team handles",
}


def _build_supervisor():
    """Build the domain supervisor graph."""
    if not TEAMS:
        # No teams yet -- supervisor just passes through
        async def passthrough(state: BaseState) -> Dict[str, Any]:
            return {"current_team": None}

        workflow = StateGraph(BaseState)
        workflow.add_node("passthrough", passthrough)
        workflow.set_entry_point("passthrough")
        workflow.add_edge("passthrough", END)
        return workflow.compile()

    # Create router for this domain
    router = create_domain_router(
        routes=TEAMS,
        level="{domain_name}",
    )

    async def domain_router(state: BaseState) -> Dict[str, Any]:
        """Route to the appropriate team within {domain_name}."""
        messages = state.get("messages", [])
        if not messages:
            return {"current_team": None}

        last_message = messages[-1]
        message_text = (
            last_message.content
            if hasattr(last_message, "content")
            else str(last_message)
        )

        current_team = state.get("current_team")
        valid_routes = list(TEAMS.keys())

        route, changed = await router.route(
            message=message_text,
            current_route=current_team,
            valid_routes=valid_routes,
            messages=messages,
        )

        updates: Dict[str, Any] = {"current_team": route}
        if changed:
            history = list(state.get("route_history", []))
            history.append(f"{domain_name}.{route}")
            updates["route_history"] = history

        return updates

    def get_team_route(state: BaseState) -> str:
        """Return the current team for conditional routing."""
        team = state.get("current_team")
        if team and team in TEAMS:
            return team
        return "__end__"

    # Build the supervisor graph
    workflow = StateGraph(BaseState)
    workflow.add_node("router", domain_router)
    workflow.set_entry_point("router")

    route_map = {"__end__": END}
    for team_name in TEAMS:
        route_map[team_name] = team_name

    workflow.add_conditional_edges("router", get_team_route, route_map)

    return workflow.compile()


# Export the compiled supervisor graph
{domain_name}_supervisor = _build_supervisor()
```

### Step 5: Create domain __init__.py

Create `graphs/domains/{domain_name}/__init__.py`:

```python
from graphs.domains.{domain_name}.supervisor import {domain_name}_supervisor

__all__ = ["{domain_name}_supervisor"]
```

### Step 6: Register domain in root_orchestrator.py

Edit `root_orchestrator.py` to add the new domain to the `DOMAINS` dict:

```python
DOMAINS: Dict[str, str] = {
    # ... existing domains ...
    "{domain_name}": "{domain_description}",
}
```

The LLM router will automatically include this domain in its routing decisions because `_build_routes_description()` reads from `DOMAINS`.

### Step 7: Add domain node to graph.py

Edit `graph.py` to:

1. Import the domain supervisor:
   ```python
   from graphs.domains.{domain_name} import {domain_name}_supervisor
   ```

2. Add it as a node:
   ```python
   builder.add_node("{domain_name}", {domain_name}_supervisor)
   ```

3. Add it to the route map for `root_orchestrator`:
   ```python
   route_map["{domain_name}"] = "{domain_name}"
   ```

4. Add edge from domain back to END (or back to root if re-routing is desired):
   ```python
   builder.add_edge("{domain_name}", END)
   ```

IMPORTANT: The `add_conditional_edges` call for root_orchestrator must be updated to include the new domain in its route map. This means you need to rebuild the conditional edges section. Read the current `graph.py`, find the `route_map` dict and the `add_conditional_edges` call, and add the new entry.

### Step 8: Update langgraph.json if needed

If the domain has its own graph entry point (for direct API access), add it:

```json
{
  "graphs": {
    "main": "graph:graph",
    "{domain_name}": "graphs.domains.{domain_name}.supervisor:{domain_name}_supervisor"
  }
}
```

This is optional -- only add if the user wants the domain accessible as a standalone graph.

### Step 9: Report results

```
Domain "{domain_name}" created successfully.

Files created:
  graphs/domains/{domain_name}/
    __init__.py
    supervisor.py             -- Domain supervisor with LLM routing
    state.py                  -- Domain-specific state fields
    teams/
      __init__.py             -- Empty, ready for /create-team

Files modified:
  root_orchestrator.py        -- Added "{domain_name}" to DOMAINS registry
  graph.py                    -- Added {domain_name}_supervisor node and routing edge

Next step: Run /create-team to add teams to this domain.
  Example: /create-team {domain_name} my_first_team
```

## Files Created

| File | Purpose |
|------|---------|
| `graphs/domains/{name}/__init__.py` | Domain package, exports supervisor |
| `graphs/domains/{name}/supervisor.py` | Domain supervisor with LLM team routing |
| `graphs/domains/{name}/state.py` | Domain-specific state extension |
| `graphs/domains/{name}/teams/__init__.py` | Empty package for future teams |

## Files Modified

| File | Changes |
|------|---------|
| `root_orchestrator.py` | Added domain to `DOMAINS` dict |
| `graph.py` | Added domain supervisor node and conditional routing edge |
| `langgraph.json` | (optional) Added domain graph entry |

## Example Usage

```
User: /create-domain
Claude: What's the domain name? (snake_case, e.g., scheduling, knowledge)
User: customer_support
Claude: What does this domain handle?
User: Handles all customer support interactions -- ticket routing, FAQ, escalation
Claude: [Creates graphs/domains/customer_support/ with supervisor]
        [Registers in root_orchestrator.py DOMAINS]
        [Adds node to graph.py]

        Domain "customer_support" created. Run /create-team customer_support to add teams.
```

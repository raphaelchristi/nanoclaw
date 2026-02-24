---
name: topology-hierarchical
description: Apply a hierarchical multi-agent topology. Creates Root Orchestrator -> Domain Supervisors -> Teams -> Agents hierarchy with LLM-based routing. Use when user says "topology hierarchical", "hierarchical agents", "supervisor topology", "ceppem-mvp architecture", or wants a tree-structured multi-agent system.
---

# Topology: Hierarchical

Apply a hierarchical multi-agent architecture to the current LangGraph project. This creates a tree-structured system where a root orchestrator routes to domain supervisors, which route to teams, which contain agents.

## What This Creates

```
                    +---------------------+
                    |  root_orchestrator  |
                    |   (LLM Router)      |
                    +-----+--------+------+
                          |        |
               +----------+        +----------+
               |                              |
     +---------v---------+          +---------v---------+
     | domain_supervisor |          | domain_supervisor |
     |   (LLM Router)    |          |   (LLM Router)    |
     +----+--------+-----+          +-------------------+
          |        |                  (add domains later
          |        |                   with /create-domain)
   +------v--+  +--v------+
   |  team   |  |  team   |
   | (ReAct) |  | (ReAct) |
   +---------+  +---------+
```

## Prerequisites

- The user must have run `/init` (or manually set up a LangGraph project with `state.py`, `graph.py`, `langgraph.json`)
- The project root must contain `state.py` with a `BaseState` TypedDict
- The project root must contain `graph.py` with a StateGraph
- The `library/` directory from AOD Engine must be available (either copied into the project or importable)

## Parameters

Ask the user for:

1. **Project root** -- The directory containing the LangGraph project (default: current working directory). Confirm by checking for `state.py` and `graph.py`.
2. **Initial domain** (optional) -- If the user wants a domain created immediately, ask for:
   - Domain name (e.g., `scheduling`, `knowledge`, `customer_support`)
   - Domain description (used in the LLM router prompt)
3. **Router model** -- Which LLM to use for routing (default: `gpt-4o-mini`). The router uses structured output, so it needs a capable model.

## Workflow

### Step 1: Verify project structure

Confirm these files exist in the project root:
- `state.py` -- Must contain `BaseState` TypedDict
- `graph.py` -- Must contain a `StateGraph`
- `langgraph.json`
- `config/settings.py`

If any are missing, tell the user to run `/init` first.

### Step 2: Copy library patterns into the project

Copy the following files from the AOD Engine `library/` directory into the project. If a `library/` directory already exists in the project, merge carefully.

```
{project_root}/
  library/
    __init__.py
    routers/
      __init__.py
      llm_router.py          <-- from aod-engine/library/routers/llm_router.py
      sticky_router.py        <-- from aod-engine/library/routers/sticky_router.py
    patterns/
      __init__.py
      supervisor.py           <-- from aod-engine/library/patterns/supervisor.py
      react_agent.py          <-- from aod-engine/library/patterns/react_agent.py
      coordinator.py          <-- from aod-engine/library/patterns/coordinator.py
    state/
      __init__.py
      routing_state.py        <-- from aod-engine/library/state/routing_state.py
    hooks/
      __init__.py
      intent_classifier.py    <-- from aod-engine/library/hooks/intent_classifier.py
```

The source files are at `library/`. Read each one and write it into the project, preserving content exactly.

### Step 3: Extend state.py with routing fields

Add the RoutingState fields to `state.py`. The result should look like:

```python
"""State for hierarchical multi-agent system."""

from typing import Any, Dict, List, Optional, Annotated

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class BaseState(TypedDict):
    """State with routing fields for hierarchical topology."""

    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    metadata: Dict[str, Any]

    # Routing fields (added by /topology hierarchical)
    current_domain: Optional[str]
    current_team: Optional[str]
    current_squad: Optional[str]
    current_agent: Optional[str]
    previous_route: Optional[str]
    route_locked: bool
    route_history: List[str]
```

Do NOT create a separate RoutingState class in the project state.py. Merge the fields directly into BaseState. The `library/state/routing_state.py` exists as a reference/documentation, but the actual state is in `state.py`.

### Step 4: Create the root orchestrator

Create `{project_root}/root_orchestrator.py`:

```python
"""Root orchestrator -- entry point for the hierarchical topology.

Routes incoming messages to domain supervisors using LLM classification.
"""

from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI

from config.settings import settings
from library.routers.llm_router import LLMRouter
from library.routers.sticky_router import StickyRouter
from state import BaseState


# Domain registry -- /create-domain adds entries here
DOMAINS: Dict[str, str] = {
    # "domain_name": "Description of what this domain handles",
}


def _build_routes_description() -> str:
    """Build the routes description for the LLM router."""
    if not DOMAINS:
        return "No domains registered yet."
    lines = []
    for name, description in DOMAINS.items():
        lines.append(f"- {name}: {description}")
    return "\n".join(lines)


# Initialize the router
_llm = ChatOpenAI(model=settings.default_model, temperature=0)
_router = LLMRouter(
    llm=_llm,
    routes_description=_build_routes_description(),
    default_route="__end__",
    level="root",
)
_sticky_router = StickyRouter(_router)


async def root_orchestrator(state: BaseState) -> Dict[str, Any]:
    """Classify and route the incoming message to a domain."""
    messages = state.get("messages", [])
    if not messages:
        return {"current_domain": None}

    last_message = messages[-1]
    message_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    valid_routes = list(DOMAINS.keys())
    current = state.get("current_domain")

    if not valid_routes:
        # No domains registered yet
        return {"current_domain": None}

    route, changed = await _sticky_router.route(
        message=message_text,
        current_route=current,
        valid_routes=valid_routes,
        messages=messages,
    )

    updates: Dict[str, Any] = {"current_domain": route}
    if changed:
        history = list(state.get("route_history", []))
        history.append(route)
        updates["route_history"] = history
        updates["previous_route"] = current

    return updates


def get_route(state: BaseState) -> str:
    """Return the current domain for conditional edge routing."""
    domain = state.get("current_domain")
    if domain and domain in DOMAINS:
        return domain
    return "__end__"
```

### Step 5: Create shared/router.py utility

Create `{project_root}/shared/router.py`:

```python
"""Shared router utilities for the hierarchical topology."""

from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI

from config.settings import settings
from library.routers.llm_router import LLMRouter
from library.routers.sticky_router import StickyRouter


def create_domain_router(
    routes: Dict[str, str],
    level: str,
    default_route: str = "__end__",
    model: Optional[str] = None,
) -> StickyRouter:
    """Create a sticky LLM router for a domain supervisor.

    Args:
        routes: Dict mapping route name -> description.
        level: Router level name (for logging).
        default_route: Fallback route.
        model: LLM model to use (defaults to settings.default_model).

    Returns:
        StickyRouter wrapping an LLMRouter.
    """
    llm = ChatOpenAI(model=model or settings.default_model, temperature=0)

    lines = [f"- {name}: {desc}" for name, desc in routes.items()]
    routes_description = "\n".join(lines)

    router = LLMRouter(
        llm=llm,
        routes_description=routes_description,
        default_route=default_route,
        level=level,
    )
    return StickyRouter(router)
```

Also create `{project_root}/shared/__init__.py` (empty or with a comment).

### Step 6: Rewrite graph.py

Replace the contents of `graph.py` with:

```python
"""Main graph -- hierarchical topology with root orchestrator."""

from langgraph.graph import END, StateGraph

from state import BaseState
from root_orchestrator import root_orchestrator, get_route, DOMAINS

# Build the graph
builder = StateGraph(BaseState)

# Root orchestrator is the entry point
builder.add_node("root_orchestrator", root_orchestrator)
builder.set_entry_point("root_orchestrator")

# Conditional routing to domains
# NOTE: /create-domain adds domain nodes and updates this routing.
# Initially, with no domains, the root just routes to END.
route_map = {"__end__": END}
for domain_name in DOMAINS:
    # Domain nodes are added by /create-domain
    route_map[domain_name] = domain_name

builder.add_conditional_edges("root_orchestrator", get_route, route_map)

# Compile
graph = builder.compile()
```

### Step 7: Update langgraph.json

Ensure `langgraph.json` still references the correct graph entry point:

```json
{
  "graphs": {
    "main": "graph:graph"
  }
}
```

### Step 8: Create domains directory structure

Create the directory `{project_root}/graphs/domains/` for future domain creation:

```bash
mkdir -p graphs/domains
```

Create `{project_root}/graphs/__init__.py` and `{project_root}/graphs/domains/__init__.py` (empty files).

### Step 9: If an initial domain was requested

If the user specified an initial domain in the parameters, invoke the `/create-domain` skill immediately to create it.

### Step 10: Report what was created

Tell the user:

```
Hierarchical topology applied successfully.

Files created:
  root_orchestrator.py        -- Root orchestrator with LLM routing
  shared/router.py            -- Reusable router factory
  shared/__init__.py
  library/                    -- Pattern library (routers, patterns, state, hooks)
  graphs/domains/             -- Directory for domain supervisors

Files modified:
  state.py                    -- Added routing fields to BaseState
  graph.py                    -- Rewired to use root_orchestrator with conditional edges

Available commands:
  /create-domain              -- Add a new domain supervisor
  /create-team                -- Add a team under a domain
  /create-squad               -- Add a cross-domain squad

Next step: Run /create-domain to add your first domain.
```

## Files Created

| File | Purpose |
|------|---------|
| `root_orchestrator.py` | Entry point, LLM router to domain supervisors |
| `shared/router.py` | Factory for creating domain-level routers |
| `shared/__init__.py` | Package init |
| `library/routers/llm_router.py` | Generic LLM router with structured output |
| `library/routers/sticky_router.py` | Sticky routing wrapper |
| `library/patterns/supervisor.py` | Supervisor pattern factory |
| `library/patterns/react_agent.py` | ReAct agent pattern factory |
| `library/patterns/coordinator.py` | Hub-spoke coordinator pattern |
| `library/state/routing_state.py` | Reference for routing state fields |
| `library/hooks/intent_classifier.py` | Intent classification hook |
| `graphs/domains/` | Empty directory for future domains |

## Files Modified

| File | Changes |
|------|---------|
| `state.py` | Added routing fields: `current_domain`, `current_team`, `current_squad`, `current_agent`, `previous_route`, `route_locked`, `route_history` |
| `graph.py` | Replaced placeholder with root_orchestrator entry point and conditional routing |

## Example Usage

```
User: /topology hierarchical
Claude: I'll set up a hierarchical topology. What's your project root? [confirms]
       Would you like to create an initial domain now, or set up the skeleton first?
User: Create a "customer_support" domain
Claude: [Applies topology, then runs /create-domain for customer_support]
```

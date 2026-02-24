---
name: add-subgraph
description: "Add a subgraph as a node in the LangGraph graph. Creates a self-contained compiled graph and mounts it as a node. Triggers on \"add subgraph\", \"new subgraph\", \"nested graph\", \"add sub-graph\", \"compose graph\"."
---

# Add Subgraph to Graph

Add a subgraph (a self-contained compiled LangGraph) as a node in the parent `graph.py`. Subgraphs encapsulate complex logic into reusable, composable units. The subgraph is compiled independently and added to the parent graph as a regular node.

## Prerequisites

- An initialized AOD Engine project with `graph.py` and `.aod/state.yaml`.
- The `subgraphs/` directory must exist (created by `/init`).

## Parameters

Gather these from the user. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `subgraph_name` | Yes | — | Snake_case name for the subgraph (e.g., `research_pipeline`, `tool_loop`). |
| `description` | No | `""` | What the subgraph does. |
| `pattern` | No | `custom` | One of: `react_agent`, `pipeline`, `supervisor`, `coordinator`, `aggregator`, `custom`. Determines the starting template. |
| `file_path` | No | `subgraphs/{subgraph_name}.py` | Where to create the subgraph file. Use default unless user specifies otherwise. |

### Pattern Descriptions

If the user is unsure, explain these:

- **react_agent**: Agent with tool-calling loop. Uses `library.patterns.react_agent.create_react_agent_graph`.
- **pipeline**: Sequential stages processing data in order. Uses `library.patterns.pipeline_node.create_pipeline_graph`.
- **supervisor**: Router dispatches to workers. Uses `library.patterns.supervisor.create_supervisor_graph`.
- **coordinator**: Hub-spoke with specialists reporting back. Uses `library.patterns.coordinator.create_coordinator_graph`.
- **aggregator**: Fan-out to parallel workers, then merge. Uses `library.patterns.aggregator.create_aggregator_graph`.
- **custom**: Empty subgraph with manual `StateGraph` setup.

## Workflow

### 1. Create the Subgraph File

Create `{file_path}` (default: `subgraphs/{subgraph_name}.py`).

**If pattern is `custom`:**

```python
"""Subgraph: {subgraph_name} — {description}"""

from typing import Any, Dict

from langgraph.graph import END, StateGraph
from state import BaseState


def build_{subgraph_name}() -> Any:
    """Build and compile the {subgraph_name} subgraph.

    Returns:
        Compiled StateGraph ready to be added as a node.
    """
    builder = StateGraph(BaseState)

    # TODO: Add nodes
    # builder.add_node("step_one", step_one_fn)

    # TODO: Set entry point
    # builder.set_entry_point("step_one")

    # TODO: Add edges
    # builder.add_edge("step_one", END)

    return builder.compile()


# Compiled subgraph instance — import this in graph.py
{subgraph_name}_graph = build_{subgraph_name}()
```

**If pattern is `react_agent`:**

```python
"""Subgraph: {subgraph_name} — {description}

Uses the ReAct agent pattern: agent -> should_continue -> tools -> agent loop.
"""

from typing import Any, Dict

from langchain_core.messages import BaseMessage
from config import settings
from state import BaseState
from library.patterns.react_agent import create_react_agent_graph


async def {subgraph_name}_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    """Agent node that invokes the LLM with tools.

    TODO: Configure the chat model, system prompt, and bind tools.
    """
    from langchain_openai import ChatOpenAI  # Adjust for your provider

    tools = []  # TODO: Add tools
    llm = ChatOpenAI(model=settings.default_model)
    if tools:
        llm = llm.bind_tools(tools)

    messages = state.get("messages", [])
    response = await llm.ainvoke(messages)
    return {"messages": [response]}


# TODO: Add your tools to this list
tools = []

# Compiled subgraph instance
{subgraph_name}_graph = create_react_agent_graph(
    agent_node={subgraph_name}_agent,
    tools=tools,
    state_class=BaseState,
    name="{subgraph_name}",
)
```

Adjust the LLM import based on `llm_provider` from `.aod/state.yaml` (same logic as in add-node).

**If pattern is `pipeline`:**

```python
"""Subgraph: {subgraph_name} — {description}

Sequential pipeline: stage_1 -> stage_2 -> ... -> END.
"""

from typing import Any, Dict

from state import BaseState
from library.patterns.pipeline_node import create_pipeline_graph


async def stage_one(state: Dict[str, Any]) -> Dict[str, Any]:
    """First pipeline stage. TODO: Implement."""
    return {}


async def stage_two(state: Dict[str, Any]) -> Dict[str, Any]:
    """Second pipeline stage. TODO: Implement."""
    return {}


# Compiled subgraph instance
{subgraph_name}_graph = create_pipeline_graph(
    stages=[
        {"name": "stage_one", "node": stage_one},
        {"name": "stage_two", "node": stage_two},
    ],
    state_class=BaseState,
)
```

**If pattern is `supervisor`:**

```python
"""Subgraph: {subgraph_name} — {description}

Supervisor routes messages to specialized workers.
"""

from typing import Any, Dict

from state import BaseState
from library.patterns.supervisor import create_supervisor_graph


async def router(state: Dict[str, Any]) -> Dict[str, Any]:
    """Router node that classifies and routes. TODO: Implement."""
    return {}


def route_function(state: Dict[str, Any]) -> str:
    """Return the worker name to route to. TODO: Implement."""
    return "__end__"


async def worker_a(state: Dict[str, Any]) -> Dict[str, Any]:
    """Worker A. TODO: Implement."""
    return {}


# Compiled subgraph instance
{subgraph_name}_graph = create_supervisor_graph(
    router_node=router,
    route_function=route_function,
    workers={"worker_a": worker_a},
    state_class=BaseState,
)
```

**If pattern is `coordinator`:**

```python
"""Subgraph: {subgraph_name} — {description}

Hub-spoke coordinator dispatches to specialists.
"""

from typing import Any, Dict

from state import BaseState
from library.patterns.coordinator import create_coordinator_graph


async def coordinator(state: Dict[str, Any]) -> Dict[str, Any]:
    """Central coordinator. TODO: Implement."""
    return {}


def dispatch_function(state: Dict[str, Any]) -> str:
    """Return which specialist to call. TODO: Implement."""
    return "__end__"


async def specialist_a(state: Dict[str, Any]) -> Dict[str, Any]:
    """Specialist A. TODO: Implement."""
    return {}


# Compiled subgraph instance
{subgraph_name}_graph = create_coordinator_graph(
    coordinator_node=coordinator,
    dispatch_function=dispatch_function,
    specialists={"specialist_a": specialist_a},
    state_class=BaseState,
)
```

**If pattern is `aggregator`:**

```python
"""Subgraph: {subgraph_name} — {description}

Fan-out to parallel workers, then aggregate results.
"""

from typing import Any, Dict

from state import BaseState
from library.patterns.aggregator import create_aggregator_graph


async def fan_out(state: Dict[str, Any]) -> Dict[str, Any]:
    """Distribute work to parallel workers. TODO: Implement."""
    return {}


async def worker_a(state: Dict[str, Any]) -> Dict[str, Any]:
    """Parallel worker A. TODO: Implement."""
    return {}


async def aggregator(state: Dict[str, Any]) -> Dict[str, Any]:
    """Collect and merge worker outputs. TODO: Implement."""
    return {}


# Compiled subgraph instance
{subgraph_name}_graph = create_aggregator_graph(
    fan_out_node=fan_out,
    workers={"worker_a": worker_a},
    aggregator_node=aggregator,
    state_class=BaseState,
)
```

### 2. Modify graph.py

**Add import** at the top of the file, after existing imports:

```python
from subgraphs.{subgraph_name} import {subgraph_name}_graph
```

**Add as node** to the builder, before `builder.compile()`:

```python
builder.add_node("{subgraph_name}", {subgraph_name}_graph)
```

This works because LangGraph accepts compiled graphs as nodes. The subgraph's internal state is mapped through the parent state automatically when the state classes are compatible.

### 3. Update .aod/state.yaml

Add the subgraph to both `graph.nodes` and `graph.subgraphs`:

```yaml
graph:
  nodes:
    - name: "{subgraph_name}"
      type: subgraph
      file: "{file_path}"
      description: "{description}"
  subgraphs:
    - name: "{subgraph_name}"
      file: "{file_path}"
      pattern: "{pattern}"
```

### 4. Report to User

Tell the user:
- The subgraph was created at `{file_path}`.
- It was added as a node named `"{subgraph_name}"` in `graph.py`.
- The subgraph is NOT yet wired to any edges. Use `/add-edge` to connect it.
- Mention what TODO items need to be filled in based on the pattern.
- If using a library pattern, note that the subgraph uses `library/patterns/{pattern}.py` for reference.

## File Changes

**Created:**
- `{file_path}` (default: `subgraphs/{subgraph_name}.py`) -- subgraph definition and compiled instance

**Modified:**
- `graph.py` -- added import and `builder.add_node()` call
- `.aod/state.yaml` -- added to graph.nodes and graph.subgraphs

## Example

User: "Add a subgraph called research_loop using the ReAct agent pattern"

Result:
- Created `subgraphs/research_loop.py` with ReAct agent template (agent + tools loop).
- Modified `graph.py`:
  ```python
  from subgraphs.research_loop import research_loop_graph
  ...
  builder.add_node("research_loop", research_loop_graph)
  ```
- Updated `.aod/state.yaml` with subgraph entry.
- Informed user to wire edges with `/add-edge` and implement the agent function and tools.

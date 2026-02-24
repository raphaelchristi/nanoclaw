---
name: add-node
description: "Add a node to the LangGraph graph. Triggers on \"add node\", \"new node\", \"create node\", \"add a node to the graph\"."
---

# Add Node to Graph

Add a new node to the LangGraph `graph.py`. This creates the node function file and registers it in the graph builder, but does NOT wire any edges. Edge wiring is the responsibility of the `add-edge` skill.

## Prerequisites

- An initialized AOD Engine project (has `graph.py`, `state.py`, and `.aod/state.yaml`).
- The project directory must be the current working directory or explicitly specified.

## Parameters

Gather these from the user. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `node_name` | Yes | — | Snake_case name for the node (e.g., `classify_intent`, `fetch_data`). Must be a valid Python identifier. |
| `node_type` | Yes | — | One of: `agent`, `router`, `tool_executor`, `processor`, `aggregator`, `custom`. |
| `description` | No | `""` | Short description of what the node does. |

### Node Types

Explain these to the user if they are unsure:

- **agent**: LLM-powered node that generates responses. Creates a function that invokes a chat model.
- **router**: Decision node that classifies input and returns a routing key. Used with conditional edges.
- **tool_executor**: Runs tools from the previous agent's tool_calls. Uses LangGraph's `ToolNode`.
- **processor**: Pure function that transforms state without LLM calls. Used in pipelines.
- **aggregator**: Collects results from multiple parallel nodes and merges them.
- **custom**: Empty async function skeleton for the user to fill in.

## Workflow

### 1. Validate Node Name

- Must be a valid Python identifier (snake_case recommended).
- Must not already exist in `graph.py`. Check by searching for `builder.add_node("{node_name}"`.
- Must not conflict with reserved names: `__end__`, `__start__`.

### 2. Create Node Function File

Create the node function in `nodes/{node_name}.py`. The file contents depend on `node_type`:

**agent:**
```python
"""Node: {node_name} — {description}"""

from typing import Any, Dict

from langchain_core.messages import BaseMessage
from config import settings


async def {node_name}(state: Dict[str, Any]) -> Dict[str, Any]:
    """Agent node that invokes the LLM.

    TODO: Configure the chat model and system prompt.
    """
    from langchain_openai import ChatOpenAI  # or appropriate provider

    llm = ChatOpenAI(model=settings.default_model)
    messages = state.get("messages", [])
    response = await llm.ainvoke(messages)
    return {"messages": [response]}
```

Adjust the import based on the project's `llm_provider` from `.aod/state.yaml`:
- openai: `from langchain_openai import ChatOpenAI` and `ChatOpenAI(model=...)`
- google: `from langchain_google_genai import ChatGoogleGenerativeAI` and `ChatGoogleGenerativeAI(model=...)`
- anthropic: `from langchain_anthropic import ChatAnthropic` and `ChatAnthropic(model=...)`

**router:**
```python
"""Node: {node_name} — {description}"""

from typing import Any, Dict, Literal


def {node_name}(state: Dict[str, Any]) -> str:
    """Router node that returns the next node to execute.

    TODO: Implement routing logic. Return a string matching
    one of the conditional edge keys.
    """
    # Example: route based on a state field
    # return "route_a" if some_condition else "route_b"
    raise NotImplementedError("Implement routing logic for {node_name}")
```

**tool_executor:**
```python
"""Node: {node_name} — {description}"""

from langgraph.prebuilt import ToolNode

# TODO: Import your tools and add them to this list
tools = []

{node_name} = ToolNode(tools)
```

**processor:**
```python
"""Node: {node_name} — {description}"""

from typing import Any, Dict


async def {node_name}(state: Dict[str, Any]) -> Dict[str, Any]:
    """Processor node that transforms state.

    TODO: Implement processing logic. Read from state,
    transform data, return state updates.
    """
    return {{}}
```

**aggregator:**
```python
"""Node: {node_name} — {description}"""

from typing import Any, Dict, List


async def {node_name}(state: Dict[str, Any]) -> Dict[str, Any]:
    """Aggregator node that merges results from parallel branches.

    TODO: Implement aggregation logic. Collect results from
    state and merge them.
    """
    return {{}}
```

**custom:**
```python
"""Node: {node_name} — {description}"""

from typing import Any, Dict


async def {node_name}(state: Dict[str, Any]) -> Dict[str, Any]:
    """Custom node.

    TODO: Implement your logic here.
    """
    return {{}}
```

### 3. Modify graph.py

Make two changes to `graph.py`:

**Add import** at the top of the file, after existing imports:

```python
from nodes.{node_name} import {node_name}
```

**Add node** to the builder, before the `graph = builder.compile()` line:

```python
builder.add_node("{node_name}", {node_name})
```

Place the `add_node` call in a logical position:
- After the `builder = StateGraph(...)` line.
- After any existing `builder.add_node()` calls.
- Before `builder.set_entry_point()` and `builder.compile()`.

### 4. Update .aod/state.yaml

Add the node to the `graph.nodes` list:

```yaml
graph:
  nodes:
    - name: "{node_name}"
      type: "{node_type}"
      file: "nodes/{node_name}.py"
      description: "{description}"
```

### 5. Report to User

Tell the user:
- The node function was created at `nodes/{node_name}.py`.
- The node was registered in `graph.py`.
- The node is NOT yet wired to any edges. Use `/add-edge` to connect it.
- If the node type has TODO items, mention what needs to be filled in.

## File Changes

**Created:**
- `nodes/{node_name}.py` -- node function implementation

**Modified:**
- `graph.py` -- added import and `builder.add_node()` call
- `.aod/state.yaml` -- added node to graph.nodes list

## Example

User: "Add a node called classify_intent of type router"

Result:
- Created `nodes/classify_intent.py` with router skeleton returning a routing key.
- Modified `graph.py`:
  ```python
  from nodes.classify_intent import classify_intent
  ...
  builder.add_node("classify_intent", classify_intent)
  ```
- Updated `.aod/state.yaml` with the new node entry.
- Informed user to wire edges with `/add-edge` and implement the routing logic in the TODO.

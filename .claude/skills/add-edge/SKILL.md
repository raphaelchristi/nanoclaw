---
name: add-edge
description: "Connect two nodes with an edge in the LangGraph graph. Supports fixed and conditional edges. Triggers on \"add edge\", \"connect nodes\", \"wire nodes\", \"link nodes\", \"add connection\"."
---

# Add Edge to Graph

Connect two nodes in the LangGraph `graph.py` with either a fixed edge or conditional edges. This skill only wires connections -- it does not create nodes (use `add-node` for that).

## Prerequisites

- An initialized AOD Engine project with `graph.py` and `.aod/state.yaml`.
- Both source and target nodes must already exist in the graph (registered via `builder.add_node()`).

## Parameters

Gather these from the user. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `source_node` | Yes | — | Name of the source node. Must already exist in the graph. |
| `target_node` | Yes (for fixed) | — | Name of the target node. Use `END` or `__end__` for the terminal node. |
| `edge_type` | Yes | `fixed` | Either `fixed` or `conditional`. |
| `condition_function` | Yes (conditional) | — | Name of the function that returns the routing key. Can be an existing router node function or a new inline function. |
| `route_map` | Yes (conditional) | — | Dictionary mapping routing keys to target node names. Example: `{"tools": "tool_executor", "end": "__end__"}` |

### Validation Before Proceeding

Read `graph.py` to verify:
1. The `source_node` exists (has a `builder.add_node("{source_node}", ...)` call).
2. For fixed edges: the `target_node` exists or is `END`/`__end__`.
3. For conditional edges: all values in `route_map` exist as nodes or are `END`/`__end__`.
4. The edge does not already exist (no duplicate `builder.add_edge("{source_node}", "{target_node}")` call).

If validation fails, tell the user which nodes are missing and suggest using `/add-node` first.

## Workflow

### Fixed Edge

A fixed edge always routes from source to target unconditionally.

#### 1. Modify graph.py

Add the edge call after the `builder.add_node()` calls and before `builder.compile()`:

```python
builder.add_edge("{source_node}", "{target_node}")
```

If the target is `END` or `__end__`, use the `END` constant:

```python
builder.add_edge("{source_node}", END)
```

Ensure `END` is imported from `langgraph.graph` (it should already be in the base template).

### Conditional Edge

A conditional edge routes from the source to one of several targets based on a function's return value.

#### 1. Determine the Condition Function

There are three scenarios:

**A. The source node IS a router node** (its function returns a string key):
- Use the router node's function directly as the condition.
- The condition function name is the same as the node name.
- No separate condition function file is needed since LangGraph will call the node, get the state update, then call the condition function on the updated state.
- Actually, for router nodes, the pattern is: the router node updates state (e.g., sets a `next_node` field), and a separate condition function reads that field. OR, the condition function is a standalone function that reads state and returns the key.

**B. Use the `should_continue` pattern** (for agent -> tool loops):
- This is the most common conditional edge pattern.
- The condition checks if the last message has `tool_calls`.
- Create or import the condition function.

**C. A new custom condition function**:
- Ask the user what the condition logic should be.
- Create the function in the same file as the source node, or in a separate `conditions/` file.

#### 2. Create Condition Function (if needed)

If a new condition function is needed, create it. Common patterns:

**should_continue (for tool loops):**
```python
def should_continue(state: Dict[str, Any]) -> str:
    """Route to tools if the agent made tool calls, otherwise end."""
    messages = state.get("messages", [])
    if not messages:
        return "end"
    last_message = messages[-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "end"
```

**Custom condition:**
```python
def {condition_function}(state: Dict[str, Any]) -> str:
    """Route based on state.

    Returns one of: {list of route_map keys}
    """
    # TODO: implement condition logic
    raise NotImplementedError
```

Place the condition function in `graph.py` above the edge wiring, or in a separate file and import it.

#### 3. Modify graph.py

Add the conditional edge call:

```python
builder.add_conditional_edges(
    "{source_node}",
    {condition_function},
    {route_map_as_python_dict},
)
```

The route map must use the `END` constant for terminal routes:

```python
builder.add_conditional_edges(
    "agent",
    should_continue,
    {"tools": "tool_executor", "end": END},
)
```

Ensure all necessary imports are present at the top of `graph.py`.

### 2. Update .aod/state.yaml

Add the edge to the `graph.edges` list:

**Fixed edge:**
```yaml
graph:
  edges:
    - source: "{source_node}"
      target: "{target_node}"
      type: fixed
```

**Conditional edge:**
```yaml
graph:
  edges:
    - source: "{source_node}"
      target: null
      type: conditional
      condition: "{condition_function}"
      routes:
        "{key1}": "{target1}"
        "{key2}": "{target2}"
```

### 3. Report to User

Tell the user:
- The edge was added to `graph.py`.
- For conditional edges, mention the condition function and route map.
- If the graph still has `builder.set_entry_point("__end__")` (the placeholder), suggest using `/add-entry-point` to set a real entry point.
- Remind the user the graph will not compile successfully until it has a valid entry point and all referenced nodes exist.

## File Changes

**Created (conditional only, if needed):**
- Condition function -- either inline in `graph.py` or in a separate file

**Modified:**
- `graph.py` -- added `builder.add_edge()` or `builder.add_conditional_edges()` call
- `.aod/state.yaml` -- added edge to graph.edges list

## Example

User: "Connect the agent node to the tool_executor with a conditional edge"

Result:
- Added `should_continue` function to `graph.py` (if not already present).
- Modified `graph.py`:
  ```python
  builder.add_conditional_edges(
      "agent",
      should_continue,
      {"tools": "tool_executor", "end": END},
  )
  ```
- Updated `.aod/state.yaml` with the conditional edge entry.
- Reminded user to also add a fixed edge from `tool_executor` back to `agent` for the ReAct loop (if applicable).

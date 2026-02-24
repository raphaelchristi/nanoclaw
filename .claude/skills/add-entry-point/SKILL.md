---
name: add-entry-point
description: "Set the entry point of the LangGraph graph. Triggers on \"set entry point\", \"add entry point\", \"set start node\", \"graph entry\", \"starting node\"."
---

# Set Graph Entry Point

Set which node the LangGraph graph starts execution from. Every graph must have exactly one entry point. This replaces the placeholder `builder.set_entry_point("__end__")` from the base template.

## Prerequisites

- An initialized AOD Engine project with `graph.py` and `.aod/state.yaml`.
- At least one node must exist in the graph (registered via `builder.add_node()`).

## Parameters

Gather these from the user. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `entry_node` | Yes | — | Name of the node to use as the entry point. Must already exist in the graph. |

### Choosing an Entry Point

If the user is unsure which node to use, read `graph.py` and `.aod/state.yaml` to list all available nodes. Present them:

> Available nodes in your graph:
> - `node_a` (agent)
> - `node_b` (router)
> - `node_c` (processor)
>
> Which should be the entry point?

Common patterns:
- **Single agent**: The agent node is the entry point.
- **Router-first**: A router/classifier node is the entry point, with conditional edges to downstream nodes.
- **Pipeline**: The first stage is the entry point.
- **Supervisor**: The supervisor/router node is the entry point.

## Workflow

### 1. Validate Entry Node

Read `graph.py` and verify:
- The node exists (has a `builder.add_node("{entry_node}", ...)` call).
- The node name is valid (not `__end__`, not `END`).

If the node does not exist, tell the user and suggest using `/add-node` first.

### 2. Modify graph.py

Find the existing `builder.set_entry_point(...)` line and replace it:

**Before:**
```python
builder.set_entry_point("__end__")
```

**After:**
```python
builder.set_entry_point("{entry_node}")
```

There should be exactly one `set_entry_point` call in the file. If there are multiple (which would be a bug), replace all of them with the single correct one.

**Placement:** The `set_entry_point` call should be:
- After all `builder.add_node()` calls.
- After all `builder.add_edge()` and `builder.add_conditional_edges()` calls.
- Before `builder.compile()`.

If the existing line is not in the right position, move it.

### 3. Update .aod/state.yaml

Update the `graph.entry_point` field:

```yaml
graph:
  entry_point: "{entry_node}"
```

### 4. Report to User

Tell the user:
- The entry point was set to `"{entry_node}"`.
- The graph will now start execution from this node when invoked.
- If the graph still has no edges, remind them to use `/add-edge` to wire the graph.
- The graph should now compile if all referenced nodes exist and edges form a valid path to `END`.

## File Changes

**Modified:**
- `graph.py` -- replaced `builder.set_entry_point(...)` call
- `.aod/state.yaml` -- updated graph.entry_point

## Example

User: "Set the entry point to the classifier node"

Result:
- Modified `graph.py`:
  ```python
  # Before
  builder.set_entry_point("__end__")

  # After
  builder.set_entry_point("classifier")
  ```
- Updated `.aod/state.yaml`:
  ```yaml
  graph:
    entry_point: "classifier"
  ```
- Informed user the graph now starts at `classifier`.

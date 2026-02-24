---
name: topology-custom
description: Interactively design a custom topology. Guides user step by step through creating any agent graph architecture by combining primitives. Use when user says "topology custom", "custom graph", "design my own topology", or wants a topology that does not match the preset patterns.
---

# Topology: Custom (Interactive Builder)

Interactively guide the user through designing a custom multi-agent topology. This skill does not apply a preset pattern. Instead, it walks through each decision -- nodes, edges, state fields, patterns -- letting the user compose any architecture they want.

## What This Creates

Any topology the user designs. Could be a hybrid, a novel pattern, or a variation on existing topologies.

```
    +------+     +------+     +------+
    | Node |---->| Node |---->| Node |
    |  A   |     |  B   |<--->|  C   |
    +--+---+     +------+     +--+---+
       |                         |
       +-------> Node D <--------+
                 +------+
                    |
                   END

  You design it. Claude builds it.
```

## Prerequisites

- The user must have run `/init` (or manually set up a LangGraph project with `state.py`, `graph.py`, `langgraph.json`)
- The project root must contain `state.py` with a `BaseState` TypedDict
- The project root must contain `graph.py` with a StateGraph

## Workflow

This is an interactive, multi-step conversation. Use questions to guide the user through each layer of the design.

### Phase 1: Understand the Goal

Ask the user:

1. **What does your system do?** Get a high-level description of the multi-agent system.
2. **Do any preset topologies partially fit?** Mention the available presets and ask if the user wants to start from one and modify it:
   - `/topology hierarchical` -- Tree with supervisors
   - `/topology pipeline` -- Sequential chain
   - `/topology swarm` -- Dynamic self-organizing agents
   - `/topology hub-spoke` -- Central coordinator with specialists
   - `/topology map-reduce` -- Fan-out parallel processing
   - `/topology network` -- Free peer-to-peer mesh

If a preset partially fits, suggest starting from it and then modifying. If none fit, proceed with fully custom design.

### Phase 2: Define Nodes

Ask the user to list all the nodes (agents, routers, processors) in their system.

For each node, clarify:
- **Name** -- Snake_case identifier
- **Type** -- What kind of node:
  - **Agent** -- LLM-based, may have tools (uses ReAct pattern from `library/patterns/react_agent.py`)
  - **Router** -- LLM-based classifier that picks a route (uses `library/routers/llm_router.py`)
  - **Processor** -- Deterministic function, no LLM
  - **Subgraph** -- A nested graph (another topology inside a node)
- **Purpose** -- What this node does
- **Tools** (if agent) -- What tools it has access to

Draw the emerging topology back to the user as an ASCII diagram after collecting nodes.

### Phase 3: Define Edges

Ask the user how nodes connect. For each connection, clarify:

- **Source** and **Target** node
- **Type**:
  - **Direct edge** -- Always goes from source to target (`builder.add_edge`)
  - **Conditional edge** -- Goes to different targets based on state (`builder.add_conditional_edges`)
  - **Bidirectional** -- Both directions (two edges)
- **Condition** (if conditional) -- What determines the route? LLM classification? State field check? Tool output?

Draw the complete graph with edges as ASCII art for the user to confirm.

### Phase 4: Define State

Based on the nodes and edges, propose state fields. The base state already has:
- `messages` (Annotated with add_messages)
- `session_id`
- `metadata`

Propose additional fields based on the design:
- Routing fields if there are conditional edges
- Accumulator fields if there is aggregation
- Counter fields if there are loops
- Data passing fields if nodes share structured data

Ask the user to confirm or modify the state.

### Phase 5: Identify Library Patterns

Map each node to an AOD Engine library pattern where applicable:

| Node Type | Library Pattern | Source |
|-----------|----------------|--------|
| Agent with tools | `library/patterns/react_agent.py` | Creates ReAct loop |
| Router node | `library/routers/llm_router.py` | LLM structured output routing |
| Supervisor | `library/patterns/supervisor.py` | Router -> conditional -> workers |
| Coordinator | `library/patterns/coordinator.py` | Hub-spoke dispatch/aggregate |
| Aggregator | `library/patterns/aggregator.py` | Merge parallel results |
| Pipeline stage | `library/patterns/pipeline_node.py` | Sequential processing |

Copy only the needed patterns from `library/` into the project.

### Phase 6: Generate the Code

Now generate all files. For each node, create its Python file:

- Agents: `agents/{name}.py` with system prompt, LLM call, tool binding
- Routers: `{name}_router.py` or inline in graph.py
- Processors: `processors/{name}.py` with deterministic logic
- Subgraphs: `graphs/{name}/graph.py` with its own StateGraph

Update these files:
- `state.py` -- Add all new fields to BaseState
- `graph.py` -- Build the complete graph with all nodes and edges
- `main.py` -- Initialize state with all required fields

### Phase 7: Confirm and Report

Show the user:

1. Final ASCII topology diagram
2. Complete file list (created and modified)
3. How to extend the system later
4. Any relevant `/create-*` skills that apply

## Patterns Reference

When building custom topologies, these are the building blocks:

### Adding a node
```python
builder.add_node("name", async_function)
```

### Adding a direct edge
```python
builder.add_edge("source", "target")
```

### Adding a conditional edge
```python
def route_fn(state):
    if state.get("some_field") == "value":
        return "node_a"
    return "node_b"

builder.add_conditional_edges("source", route_fn, {
    "node_a": "node_a",
    "node_b": "node_b",
    "__end__": END,
})
```

### Setting entry point
```python
builder.set_entry_point("first_node")
```

### Creating a loop
```python
builder.add_node("agent", agent_fn)
builder.add_node("tools", tool_node)
builder.add_conditional_edges("agent", should_continue, {
    "tools": "tools",
    "end": END,
})
builder.add_edge("tools", "agent")  # Loop back
```

### Parallel fan-out
```python
builder.add_edge("distributor", "worker_a")
builder.add_edge("distributor", "worker_b")
builder.add_edge("worker_a", "collector")
builder.add_edge("worker_b", "collector")
```

### Nested subgraph
```python
subgraph = create_sub_graph(...)  # Returns compiled graph
builder.add_node("sub", subgraph)
```

## State Extension Patterns

```python
# Routing (for conditional edges)
current_route: Optional[str]
route_history: List[str]

# Accumulation (for aggregation)
results: Dict[str, Any]

# Counters (for loops with limits)
iteration_count: int
max_iterations: int

# Flags (for conditional logic)
task_complete: bool
needs_review: bool

# Data passing (between nodes)
shared_context: Dict[str, Any]
```

## Example Interaction

```
User: /topology custom
Claude: What does your multi-agent system do?
User: It's a code review system. Code goes through linting, security scan, and style check in parallel, then a reviewer agent looks at all results and either approves or requests changes. If changes requested, it goes back to the author agent.

Claude: That sounds like a hybrid of map-reduce (parallel checks) and a review loop.
        Let me map out the nodes:
        1. distributor (processor) -- sends code to all checkers
        2. linter (agent) -- checks for lint issues
        3. security_scanner (agent) -- checks for vulnerabilities
        4. style_checker (agent) -- checks code style
        5. reviewer (agent) -- reviews all results, decides approve/reject
        6. author (agent) -- addresses reviewer feedback

        Does this look right? Any nodes to add/remove?

User: Yes, that's right.

Claude: Now edges:
        distributor -> linter (direct)
        distributor -> security_scanner (direct)
        distributor -> style_checker (direct)
        linter -> reviewer (direct)
        security_scanner -> reviewer (direct)
        style_checker -> reviewer (direct)
        reviewer -> (conditional) approve -> END, reject -> author
        author -> reviewer (direct, loop back)

        [ASCII diagram]
        Confirm?

User: Perfect.

Claude: [Generates all files with the custom topology]
```

## Files Created

Varies based on the custom design. Typically:

| File | Purpose |
|------|---------|
| `agents/{name}.py` | One per agent node |
| `processors/{name}.py` | One per processor node |
| `graphs/{name}/` | One per subgraph |
| Various router files | As needed |
| `library/` patterns | Only the ones used |

## Files Modified

| File | Changes |
|------|---------|
| `state.py` | Custom fields based on design |
| `graph.py` | Complete custom graph |
| `main.py` | Updated initial state |

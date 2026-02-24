---
name: customize
description: Customize your AOD Engine-generated project. Use when user wants to modify topology, add custom nodes/edges, change agent behavior, or make any other customizations to their LangGraph multi-agent system.
---

# AOD Engine Customization

This skill helps users customize their LangGraph multi-agent projects. Use AskUserQuestion to understand what they want before making changes.

## Workflow

1. **Understand the request** - Ask clarifying questions
2. **Read the project** - Understand current topology via graph.py, state.py, .aod/state.yaml
3. **Plan the changes** - Identify files to modify
4. **Implement** - Make changes directly to the code
5. **Verify** - Run `python -c "from graph import graph; print('OK')"` to ensure graph compiles

## Key Files

| File | Purpose |
|------|---------|
| `graph.py` | Main graph definition (nodes, edges, entry point) |
| `state.py` | State TypedDict (shared across all nodes) |
| `main.py` | Entry point (channels, API, scheduler) |
| `langgraph.json` | Graph registration |
| `pyproject.toml` | Python dependencies |
| `config/settings.py` | Application settings |
| `.aod/state.yaml` | Applied skills tracking |
| `agents/*.py` | Agent node implementations |
| `tools/*.py` | Tool definitions |

## Common Customization Patterns

### Modifying Agent Behavior
- Change system prompts in `agents/*.py`
- Add/remove tools from an agent's tool list
- Change LLM model in agent configuration
- Modify temperature, max_tokens, etc.

### Modifying Graph Topology
- Add new edges: `builder.add_edge("source", "target")`
- Add conditional edges: `builder.add_conditional_edges("source", condition_fn, route_map)`
- Insert new nodes into existing paths
- Bypass supervisors with direct edges (flexibility!)

### Adding Custom Nodes
1. Create new node function in appropriate directory
2. Import and add to graph.py via `builder.add_node("name", node_fn)`
3. Wire edges as needed

### Changing State
1. Add fields to state.py TypedDict
2. Ensure all nodes that read/write the field are updated
3. Add necessary imports (Annotated, reducers, etc.)

### Mixing Topologies
AOD Engine supports mixing patterns! After applying a preset:
- Add map-reduce nodes to a hierarchical topology
- Add a coordinator hub to a pipeline
- Create shortcuts that bypass routing layers

## After Changes

Always tell the user to verify:
```bash
python -c "from graph import graph; print(graph.get_graph().draw_mermaid())"
```

## Example Interaction

User: "Add a direct edge from root to the positiva team, bypassing the carteira supervisor"

1. Read graph.py and root_orchestrator.py to understand current topology
2. Add conditional edge from root_orchestrator to team_positiva
3. Update the routing function to include the new shortcut
4. Verify the graph compiles

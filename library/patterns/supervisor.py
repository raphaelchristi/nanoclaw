"""Supervisor pattern — router → conditional_edges → workers → END.

Used in hierarchical topologies where a supervisor routes messages
to specialized worker subgraphs.
"""

from typing import Any, Callable, Dict, List

from langgraph.graph import END, StateGraph


def create_supervisor_graph(
    router_node: Callable,
    route_function: Callable,
    workers: Dict[str, Any],
    state_class: type,
    default_route: str = "__end__",
) -> StateGraph:
    """Create a supervisor graph that routes to workers.

    Args:
        router_node: Async function that classifies and routes messages.
        route_function: Function that returns the next node name based on state.
        workers: Dict mapping route name → compiled subgraph or node function.
        state_class: TypedDict class for the graph state.
        default_route: Route when no match found.

    Returns:
        Compiled StateGraph with supervisor routing.
    """
    workflow = StateGraph(state_class)

    # Add router node
    workflow.add_node("router", router_node)

    # Add worker nodes
    route_map = {}
    for name, worker in workers.items():
        workflow.add_node(name, worker)
        workflow.add_edge(name, END)
        route_map[name] = name

    # Route to END for default
    route_map["__end__"] = END

    workflow.set_entry_point("router")
    workflow.add_conditional_edges("router", route_function, route_map)

    return workflow.compile()

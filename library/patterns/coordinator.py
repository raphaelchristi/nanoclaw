"""Hub-spoke coordinator pattern.

Central coordinator dispatches to specialists and aggregates results.
Used in hub-spoke topologies.
"""

from typing import Any, Callable, Dict, List, Literal

from langchain_core.messages import BaseMessage
from langgraph.graph import END, StateGraph


def create_coordinator_graph(
    coordinator_node: Callable,
    dispatch_function: Callable,
    specialists: Dict[str, Any],
    state_class: type,
) -> StateGraph:
    """Create a hub-spoke coordinator graph.

    The coordinator receives messages, dispatches to specialists,
    and aggregates their responses.

    Args:
        coordinator_node: Async function for the central coordinator.
        dispatch_function: Function that returns which specialist to call.
        specialists: Dict mapping specialist name → node function or subgraph.
        state_class: TypedDict class for the graph state.

    Returns:
        Compiled StateGraph with hub-spoke pattern.
    """
    workflow = StateGraph(state_class)

    # Add coordinator
    workflow.add_node("coordinator", coordinator_node)

    # Add specialists with edges back to coordinator
    route_map = {"__end__": END}
    for name, specialist in specialists.items():
        workflow.add_node(name, specialist)
        workflow.add_edge(name, "coordinator")
        route_map[name] = name

    workflow.set_entry_point("coordinator")
    workflow.add_conditional_edges("coordinator", dispatch_function, route_map)

    return workflow.compile()

"""Pipeline node pattern — sequential processing stage.

Each node processes data and passes to the next. Used in pipeline topologies.
"""

from typing import Any, Callable, Dict, List, Optional

from langgraph.graph import END, StateGraph


def create_pipeline_node(
    process_fn: Callable,
    state_class: type,
    name: str = "processor",
) -> Callable:
    """Create a pipeline processing node.

    Pipeline nodes read from state, process, and write results back.
    The graph wiring (sequential edges) is done by the topology skill.

    Args:
        process_fn: Async function that processes and returns state update.
        state_class: TypedDict class for validation.
        name: Node identifier.

    Returns:
        Node function ready to be added to a StateGraph.
    """
    return process_fn


def create_pipeline_graph(
    stages: List[Dict[str, Callable]],
    state_class: type,
) -> StateGraph:
    """Create a full pipeline graph from ordered stages.

    Args:
        stages: List of dicts with {"name": str, "node": Callable}.
        state_class: TypedDict class for the graph state.

    Returns:
        Compiled StateGraph with sequential edges.
    """
    workflow = StateGraph(state_class)

    if not stages:
        raise ValueError("Pipeline must have at least one stage")

    # Add all nodes
    for stage in stages:
        workflow.add_node(stage["name"], stage["node"])

    # Wire sequentially
    workflow.set_entry_point(stages[0]["name"])
    for i in range(len(stages) - 1):
        workflow.add_edge(stages[i]["name"], stages[i + 1]["name"])
    workflow.add_edge(stages[-1]["name"], END)

    return workflow.compile()

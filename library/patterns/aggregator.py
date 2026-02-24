"""Map-reduce aggregator pattern.

Fan-out to multiple workers in parallel, then aggregate results.
"""

from typing import Any, Callable, Dict, List

from langgraph.graph import END, StateGraph


def create_aggregator_graph(
    fan_out_node: Callable,
    workers: Dict[str, Callable],
    aggregator_node: Callable,
    state_class: type,
) -> StateGraph:
    """Create a map-reduce graph.

    Fan-out node sends work to parallel workers, aggregator collects results.

    Args:
        fan_out_node: Distributes work to workers.
        workers: Dict mapping worker name → node function.
        aggregator_node: Collects and merges worker outputs.
        state_class: TypedDict class for the graph state.

    Returns:
        Compiled StateGraph with map-reduce pattern.
    """
    workflow = StateGraph(state_class)

    workflow.add_node("fan_out", fan_out_node)
    workflow.add_node("aggregator", aggregator_node)

    for name, worker in workers.items():
        workflow.add_node(name, worker)
        workflow.add_edge("fan_out", name)
        workflow.add_edge(name, "aggregator")

    workflow.add_edge("aggregator", END)

    workflow.set_entry_point("fan_out")

    return workflow.compile()

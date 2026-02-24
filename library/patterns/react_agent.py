"""ReAct agent pattern — agent → should_continue → tools → agent loop.

This is the fundamental building block for tool-using agents in LangGraph.
"""

from typing import Any, Callable, Dict, List, Literal, Optional, Sequence

from langchain_core.messages import BaseMessage
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode


def should_continue(state: Dict[str, Any]) -> Literal["tools", "end"]:
    """Check if the agent wants to call tools or finish."""
    messages = state.get("messages", [])
    if not messages:
        return "end"
    last_message = messages[-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "end"


def create_react_agent_graph(
    agent_node: Callable,
    tools: Sequence[Any],
    state_class: type,
    name: str = "agent",
) -> StateGraph:
    """Create a ReAct agent graph with tool loop.

    Args:
        agent_node: Async function that invokes the LLM and returns state update.
        tools: List of tool functions/objects for the agent.
        state_class: TypedDict class for the graph state.
        name: Name prefix for the nodes.

    Returns:
        Compiled StateGraph with ReAct loop.
    """
    workflow = StateGraph(state_class)

    workflow.add_node(f"{name}", agent_node)
    workflow.add_node(f"{name}_tools", ToolNode(tools))

    workflow.set_entry_point(f"{name}")

    workflow.add_conditional_edges(
        f"{name}",
        should_continue,
        {"tools": f"{name}_tools", "end": END},
    )
    workflow.add_edge(f"{name}_tools", f"{name}")

    return workflow.compile()

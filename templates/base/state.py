"""Base state for LangGraph multi-agent systems."""

from typing import Any, Dict, List, Optional, Annotated

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class BaseState(TypedDict):
    """Minimal extensible state for any LangGraph topology.

    Skills add fields via three-way merge to extend this state.
    """

    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    metadata: Dict[str, Any]

"""Generic LLM-based router for any topology.

Routes messages to the appropriate node based on LLM classification.
Topology-agnostic: works with hierarchical, hub-spoke, or any topology
that needs intelligent routing.
"""

from typing import Any, Dict, List, Optional, Tuple

from langchain_core.messages import BaseMessage
from pydantic import BaseModel, Field


class RouteClassification(BaseModel):
    """LLM structured output for route classification."""

    intent: str = Field(description="Classified intent of the message")
    suggested_route: str = Field(description="Route to send the message to")
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence")
    is_vague: bool = Field(default=False, description="Whether the message is ambiguous")
    requires_route_change: bool = Field(
        default=True, description="Whether a route change is needed"
    )


class LLMRouter:
    """Routes messages using LLM structured output.

    Args:
        llm: LangChain chat model with structured output support.
        routes_description: Text describing available routes.
        default_route: Fallback route when classification is uncertain.
        level: Router level identifier (for logging/debugging).
    """

    def __init__(
        self,
        llm: Any,
        routes_description: str,
        default_route: str,
        level: str = "root",
    ):
        self.llm = llm
        self.routes_description = routes_description
        self.default_route = default_route
        self.level = level
        self._structured_llm = llm.with_structured_output(RouteClassification)

    async def classify(
        self,
        message: str,
        current_route: Optional[str],
        messages: Optional[List[BaseMessage]] = None,
    ) -> RouteClassification:
        """Classify a message and suggest a route."""
        recent_context = ""
        if messages:
            recent = messages[-15:]
            recent_context = "\n".join(
                f"{'User' if m.type == 'human' else 'Assistant'}: {m.content}"
                for m in recent
                if hasattr(m, "content") and isinstance(m.content, str)
            )

        prompt = f"""You are a message router at the '{self.level}' level.

Available routes:
{self.routes_description}

Current route: {current_route or 'none'}

Recent conversation:
{recent_context}

New message: {message}

Classify this message and determine the best route."""

        return await self._structured_llm.ainvoke(prompt)

    def determine_route(
        self,
        classification: RouteClassification,
        current_route: Optional[str],
        valid_routes: List[str],
        entry_route: Optional[str] = None,
    ) -> Tuple[str, bool]:
        """Apply deterministic rules to determine final route.

        Returns:
            Tuple of (route, changed) where changed indicates if route changed.
        """
        # Rule 1: Vague + existing route = maintain (sticky routing)
        if classification.is_vague and current_route and current_route in valid_routes:
            return current_route, False

        # Rule 2: No current route = go to suggested or default
        if not current_route:
            route = classification.suggested_route
            if route in valid_routes:
                return route, True
            return self.default_route, True

        # Rule 3: No route change requested = maintain
        if not classification.requires_route_change:
            return current_route, False

        # Rule 4: Never return to entry after leaving
        if (
            entry_route
            and classification.suggested_route == entry_route
            and current_route != entry_route
        ):
            return current_route, False

        # Rule 5: Valid suggested route = change
        if classification.suggested_route in valid_routes:
            return classification.suggested_route, True

        # Fallback: maintain current
        return current_route, False

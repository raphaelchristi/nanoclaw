"""Sticky routing wrapper — maintains route unless explicit change is requested."""

from typing import Any, Dict, List, Optional, Tuple

from langchain_core.messages import BaseMessage


class StickyRouter:
    """Wraps any router to add sticky routing behavior.

    When the current route is set and the message doesn't explicitly
    request a change, the route is maintained. This prevents unnecessary
    context switches in conversational systems.

    Args:
        router: Any router with classify() and determine_route() methods.
        stickiness_threshold: Confidence below which route is maintained.
    """

    def __init__(self, router: Any, stickiness_threshold: float = 0.7):
        self.router = router
        self.stickiness_threshold = stickiness_threshold

    async def route(
        self,
        message: str,
        current_route: Optional[str],
        valid_routes: List[str],
        messages: Optional[List[BaseMessage]] = None,
        entry_route: Optional[str] = None,
    ) -> Tuple[str, bool]:
        """Route a message with sticky behavior.

        Returns:
            Tuple of (route, changed).
        """
        classification = await self.router.classify(message, current_route, messages)

        # Extra stickiness: low confidence + existing route = maintain
        if (
            current_route
            and current_route in valid_routes
            and classification.confidence < self.stickiness_threshold
        ):
            return current_route, False

        return self.router.determine_route(
            classification, current_route, valid_routes, entry_route
        )

"""Routing state extension for topologies with routing."""

from typing import Any, Dict, List, Optional

from typing_extensions import TypedDict


class RoutingState(TypedDict, total=False):
    """State fields for routing-enabled topologies.

    Added to BaseState when a topology with routing is applied.
    """

    current_domain: Optional[str]
    current_team: Optional[str]
    current_squad: Optional[str]
    current_agent: Optional[str]
    previous_route: Optional[str]
    route_locked: bool
    route_history: List[str]

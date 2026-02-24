"""Intent state extension for pre-tool hooks."""

from typing import Any, Dict, List, Optional

from typing_extensions import TypedDict


class IntentState(TypedDict, total=False):
    """State fields for intent classification hooks.

    Added to state when /add-hooks skill is applied.
    """

    classified_intents: List[str]
    intent_query: Optional[str]
    intent_confidence: float
    domain_context: Dict[str, Any]

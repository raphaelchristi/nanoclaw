"""Multi-intent classifier via LLM structured output.

Pre-tool hook that classifies user intents before tool execution.
Based on the ceppem-mvp pattern: scans recent messages for entity intents
and preserves previous turn intents when current message is ambiguous.
"""

from functools import wraps
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import BaseMessage
from pydantic import BaseModel, Field


INTENT_HOOK_ATTR = "_requires_intent_hook"


def requires_intent_hook(func: Callable) -> Callable:
    """Decorator to mark a tool as requiring intent classification before execution."""
    setattr(func, INTENT_HOOK_ATTR, True)
    return func


def tool_needs_intent_hook(tool: Any) -> bool:
    """Check if a tool requires the intent classification hook."""
    func = getattr(tool, "func", tool)
    return getattr(func, INTENT_HOOK_ATTR, False)


class ClassifiedIntents(BaseModel):
    """LLM structured output for intent classification."""

    intents: List[str] = Field(description="Classified intents from the message")
    entities: Dict[str, str] = Field(
        default_factory=dict,
        description="Extracted entities (e.g., date, location, name)",
    )
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence")


class IntentClassifier:
    """Classifies user intents before tool execution.

    Scans recent messages for intents and preserves previous intents
    when the current message doesn't contain new ones.

    Args:
        llm: LangChain chat model with structured output support.
        intent_categories: List of valid intent categories.
        lookback_messages: Number of recent messages to scan.
    """

    def __init__(
        self,
        llm: Any,
        intent_categories: List[str],
        lookback_messages: int = 5,
    ):
        self.llm = llm
        self.intent_categories = intent_categories
        self.lookback_messages = lookback_messages
        self._structured_llm = llm.with_structured_output(ClassifiedIntents)

    async def classify(
        self,
        messages: List[BaseMessage],
        previous_intents: Optional[List[str]] = None,
    ) -> ClassifiedIntents:
        """Classify intents from recent messages.

        Args:
            messages: Conversation messages.
            previous_intents: Intents from previous classification (for persistence).

        Returns:
            Classified intents, potentially preserving previous ones.
        """
        recent = messages[-self.lookback_messages :]
        recent_text = "\n".join(
            f"{'User' if m.type == 'human' else 'Assistant'}: {m.content}"
            for m in recent
            if hasattr(m, "content") and isinstance(m.content, str)
        )

        prompt = f"""Classify the intents in these messages.

Valid intent categories: {', '.join(self.intent_categories)}

Recent conversation:
{recent_text}

Extract the intents and any entities mentioned."""

        result = await self._structured_llm.ainvoke(prompt)

        # Preserve previous entity intents if current has none
        if previous_intents and not result.intents:
            result.intents = previous_intents

        return result

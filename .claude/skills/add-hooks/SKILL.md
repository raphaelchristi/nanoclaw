---
name: add-hooks
description: "Add pre-tool hook system with intent classification. Tools decorated with @requires_intent_hook get intent classification before execution. Uses the AOD Engine library's IntentClassifier. Triggers on 'add hooks', 'intent classification', 'pre-tool hooks', 'hook system'."
---

# Add Pre-Tool Hook System

Adds a hook system that runs intent classification before tool execution. Tools decorated with `@requires_intent_hook` get pre-classification that extracts intents and entities from the conversation, injecting the results into the tool call context.

## What This Adds

- A `hooks/__init__.py` module exporting the hook system
- A `hooks/intent_classifier.py` module copied from the AOD Engine library
- A `hooks/hook_aware_tool_node.py` that wraps LangGraph's `ToolNode` with pre-execution hooks
- Integration with the graph's tool nodes to intercept and classify before execution
- Configurable intent categories and lookback window

## Prerequisites

- The project must have a compiled graph in `graph.py` with at least one agent node that uses tools
- Tools must be defined (either inline or in a `tools/` directory)
- An LLM must be configured in settings (for the intent classifier)
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **What intent categories should the classifier recognize?**
   - Example: `["question", "action", "scheduling", "information", "escalation"]`
   - These should reflect the domain of the agent
2. **How many recent messages should the classifier consider?** (default: 5)
3. **Which tools should require intent classification?**
   - All tools (apply to the entire tool node)
   - Specific tools only (decorate individual tools with `@requires_intent_hook`)

## Workflow

### Step 1: Copy the intent classifier from the library

Create `hooks/__init__.py`:

```python
from hooks.intent_classifier import IntentClassifier, requires_intent_hook
from hooks.hook_aware_tool_node import HookAwareToolNode

__all__ = ["IntentClassifier", "requires_intent_hook", "HookAwareToolNode"]
```

Create `hooks/intent_classifier.py` by copying the content from the AOD Engine library at `library/hooks/intent_classifier.py`. The file contains:

- `requires_intent_hook` decorator: marks a tool as needing pre-classification
- `tool_needs_intent_hook` function: checks if a tool has the decorator
- `ClassifiedIntents` model: structured output with intents, entities, confidence
- `IntentClassifier` class: LLM-based classifier that scans recent messages

Read the file at `library/hooks/intent_classifier.py` in the AOD Engine repository and copy it to `hooks/intent_classifier.py` in the project.

### Step 2: Create the hook-aware tool node

Create `hooks/hook_aware_tool_node.py`:

```python
"""Hook-aware tool node — runs pre-execution hooks before tool calls."""

import logging
from typing import Any, Dict, List, Optional, Sequence

from langchain_core.messages import BaseMessage, ToolMessage
from langgraph.prebuilt import ToolNode

from hooks.intent_classifier import (
    ClassifiedIntents,
    IntentClassifier,
    tool_needs_intent_hook,
)

logger = logging.getLogger(__name__)


class HookAwareToolNode(ToolNode):
    """ToolNode that runs intent classification before executing hooked tools.

    Wraps LangGraph's ToolNode to intercept tool calls for tools decorated
    with @requires_intent_hook. Before execution, it classifies the conversation
    intents and injects the classification into the tool call arguments.

    Args:
        tools: List of tool functions/objects.
        classifier: IntentClassifier instance.
        classify_all: If True, classify before ALL tools, not just decorated ones.
    """

    def __init__(
        self,
        tools: Sequence[Any],
        classifier: Optional[IntentClassifier] = None,
        classify_all: bool = False,
    ):
        super().__init__(tools)
        self.classifier = classifier
        self.classify_all = classify_all
        self._previous_intents: Optional[List[str]] = None

    async def _arun(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Run with pre-execution hooks."""
        messages = state.get("messages", [])

        if self.classifier and messages:
            # Check if any pending tool call needs classification
            last_message = messages[-1]
            needs_classification = False

            if hasattr(last_message, "tool_calls") and last_message.tool_calls:
                if self.classify_all:
                    needs_classification = True
                else:
                    for tool_call in last_message.tool_calls:
                        tool_name = tool_call.get("name", "")
                        tool = self._get_tool_by_name(tool_name)
                        if tool and tool_needs_intent_hook(tool):
                            needs_classification = True
                            break

            if needs_classification:
                try:
                    classification = await self.classifier.classify(
                        messages, self._previous_intents
                    )
                    self._previous_intents = classification.intents

                    # Inject classification into state metadata
                    metadata = state.get("metadata", {})
                    metadata["classified_intents"] = classification.intents
                    metadata["classified_entities"] = classification.entities
                    metadata["intent_confidence"] = classification.confidence
                    state["metadata"] = metadata

                    logger.debug(
                        f"Intent classification: {classification.intents} "
                        f"(confidence: {classification.confidence:.2f})"
                    )
                except Exception:
                    logger.exception("Intent classification failed, proceeding without")

        # Execute the actual tool calls
        return await super()._arun(state)

    def _get_tool_by_name(self, name: str) -> Optional[Any]:
        """Look up a tool by name from the registered tools."""
        for tool in self.tools:
            tool_name = getattr(tool, "name", None) or getattr(tool, "__name__", "")
            if tool_name == name:
                return tool
        return None
```

### Step 3: Modify the graph to use HookAwareToolNode

In the project's `graph.py` (or wherever the graph is defined), replace `ToolNode` with `HookAwareToolNode`:

**Before:**
```python
from langgraph.prebuilt import ToolNode

builder.add_node("tools", ToolNode(tools))
```

**After:**
```python
from hooks import HookAwareToolNode, IntentClassifier
from langchain_openai import ChatOpenAI  # or whichever LLM

classifier = IntentClassifier(
    llm=ChatOpenAI(model="gpt-4o-mini"),
    intent_categories=["question", "action", "scheduling", "information"],
    lookback_messages=5,
)

builder.add_node("tools", HookAwareToolNode(tools, classifier=classifier))
```

### Step 4: Decorate tools that need classification

For tools that should trigger intent classification before execution:

```python
from hooks import requires_intent_hook
from langchain_core.tools import tool


@requires_intent_hook
@tool
def schedule_meeting(date: str, participants: str) -> str:
    """Schedule a meeting."""
    # The intent classification is available in the state metadata
    return f"Meeting scheduled for {date} with {participants}"
```

### Step 5: Update pyproject.toml

No additional dependencies needed beyond what the base project already includes (`langchain-core`, `langgraph`, `pydantic`). The intent classifier uses the LLM already configured in the project.

## Files Created

| File | Purpose |
|------|---------|
| `hooks/__init__.py` | Package exports |
| `hooks/intent_classifier.py` | Copied from `library/hooks/intent_classifier.py` |
| `hooks/hook_aware_tool_node.py` | ToolNode wrapper with pre-execution hook support |

## Files Modified

| File | Change |
|------|--------|
| `graph.py` | Replace `ToolNode` with `HookAwareToolNode`, configure `IntentClassifier` |
| Tool files | Decorate tools with `@requires_intent_hook` as needed |

## Example

User: "Add intent classification hooks to my tools"

1. Ask what intent categories to recognize
2. Ask which tools should have classification
3. Copy `intent_classifier.py` from the AOD Engine library
4. Create `hook_aware_tool_node.py`
5. Modify `graph.py` to use `HookAwareToolNode`
6. Show how to decorate specific tools
7. Tell the user: "Intent classification now runs before tool execution. Check `state['metadata']['classified_intents']` to see the results."

## Verification

After setup, the user should:
1. Run the graph with a message that triggers a tool call
2. Check the logs for "Intent classification: ..." debug messages
3. Verify that `state['metadata']` contains `classified_intents`, `classified_entities`, and `intent_confidence`
4. Test with ambiguous messages to verify intent persistence from previous turns

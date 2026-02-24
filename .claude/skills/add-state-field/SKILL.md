---
name: add-state-field
description: "Add a field to the LangGraph state TypedDict. Triggers on \"add state field\", \"add field to state\", \"extend state\", \"new state field\", \"add state variable\"."
---

# Add State Field

Add a new field to the `BaseState` TypedDict in `state.py`. This extends the shared state that flows through all nodes in the graph.

## Prerequisites

- An initialized AOD Engine project with `state.py` and `.aod/state.yaml`.
- The project must have a `BaseState` TypedDict class in `state.py`.

## Parameters

Gather these from the user. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `field_name` | Yes | — | Snake_case name for the field (e.g., `current_route`, `search_results`). Must be a valid Python identifier. |
| `field_type` | Yes | — | Python type annotation (e.g., `str`, `int`, `List[str]`, `Optional[Dict[str, Any]]`, `Annotated[List[BaseMessage], add_messages]`). |
| `default_value` | No | `None` | Default value for the field. Use `None` for Optional types. For non-optional types without defaults, the field becomes required in graph invocations. |
| `description` | No | `""` | Docstring-style description of what the field represents. |

### Common Type Patterns

If the user is unsure, suggest these common patterns:

| Use Case | Type | Default |
|----------|------|---------|
| Text data | `str` | `""` |
| Flag/toggle | `bool` | `False` |
| Counter | `int` | `0` |
| Routing key | `Optional[str]` | `None` |
| List of strings | `List[str]` | `[]` |
| Key-value store | `Dict[str, Any]` | `{}` |
| Accumulating messages | `Annotated[List[BaseMessage], add_messages]` | (already exists as `messages`) |
| Optional structured data | `Optional[Dict[str, Any]]` | `None` |
| List of results | `List[Dict[str, Any]]` | `[]` |

## Workflow

### 1. Validate Field Name

- Must be a valid Python identifier (snake_case).
- Must not already exist in `BaseState`. Read `state.py` and check for duplicate field names.
- Must not shadow Python builtins or LangGraph reserved names.

### 2. Determine Required Imports

Read the current imports in `state.py` and determine what new imports are needed based on `field_type`.

Common imports that may need to be added:

| Type Used | Import Needed |
|-----------|--------------|
| `List` | `from typing import List` (likely already present) |
| `Dict` | `from typing import Dict` (likely already present) |
| `Optional` | `from typing import Optional` (likely already present) |
| `Annotated` | `from typing import Annotated` (likely already present) |
| `Set` | `from typing import Set` |
| `Tuple` | `from typing import Tuple` |
| `BaseMessage` | `from langchain_core.messages import BaseMessage` (likely already present) |
| `HumanMessage` | `from langchain_core.messages import HumanMessage` |
| `AIMessage` | `from langchain_core.messages import AIMessage` |
| `add_messages` | `from langgraph.graph.message import add_messages` (likely already present) |
| Pydantic models | `from pydantic import BaseModel` |

Check existing imports first. Only add imports that are not already present. When adding to an existing `from typing import ...` line, extend it rather than adding a duplicate import line.

### 3. Modify state.py

**Add imports** (if needed) at the top of the file, extending existing import lines where possible.

**Add the field** to the `BaseState` class. Place it after the existing fields, maintaining the same indentation:

**If using TypedDict with `total=True` (default):**

For optional fields (those with default `None`), the field type should use `Optional[...]`:

```python
class BaseState(TypedDict):
    """..."""

    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    metadata: Dict[str, Any]
    {field_name}: {field_type}  # {description}
```

**Important note about TypedDict and defaults:** Standard `TypedDict` does not support default values directly. There are two approaches:

1. **Optional fields** -- Use `Optional[T]` and handle `None` in node functions. The field must be provided when invoking the graph, but can be `None`.

2. **total=False inheritance** -- If the user wants truly optional fields (not required at invocation), create or extend a secondary TypedDict with `total=False`:

```python
class BaseState(TypedDict):
    """Required fields."""
    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    metadata: Dict[str, Any]


class ExtendedState(BaseState, total=False):
    """Optional fields added by skills."""
    {field_name}: {field_type}
```

**Recommendation:** For simplicity, prefer adding fields as `Optional[T]` to the existing `BaseState` class. Only use the `total=False` inheritance pattern if the user explicitly wants fields that are not required at graph invocation time.

If adding a comment for the field description, place it as an inline comment:
```python
    {field_name}: {field_type}  # {description}
```

### 4. Update graph invocations

If `main.py` invokes the graph with explicit state, check whether the new field needs to be included in the invocation. If the field has no default and is not `Optional`, the user will need to provide it.

Read `main.py` and check the `graph.ainvoke(...)` call. If the new field is non-optional, add it to the invocation dict with a sensible initial value:

```python
result = await graph.ainvoke(
    {
        "messages": [...],
        "session_id": session_id,
        "metadata": {},
        "{field_name}": {default_value},  # Add this
    }
)
```

If the field is `Optional`, no change to `main.py` is needed.

### 5. Update .aod/state.yaml

Add the field to the `state.fields` list:

```yaml
state:
  fields:
    - name: "{field_name}"
      type: "{field_type}"
      default: "{default_value}"
      description: "{description}"
```

### 6. Report to User

Tell the user:
- The field `{field_name}: {field_type}` was added to `BaseState` in `state.py`.
- Any imports that were added.
- Whether `main.py` was updated (for non-optional fields).
- How to access the field in node functions: `state.get("{field_name}")` or `state["{field_name}"]`.

## File Changes

**Modified:**
- `state.py` -- added field to `BaseState` class, possibly added imports
- `main.py` -- added field to graph invocation (only if non-optional)
- `.aod/state.yaml` -- added field to state.fields list

## Example

User: "Add a field called current_route of type Optional[str] with default None"

Result:
- Modified `state.py`:
  ```python
  class BaseState(TypedDict):
      messages: Annotated[List[BaseMessage], add_messages]
      session_id: str
      metadata: Dict[str, Any]
      current_route: Optional[str]  # Current routing destination
  ```
- `Optional` was already imported, no new imports needed.
- `main.py` not modified (field is Optional).
- Updated `.aod/state.yaml`.

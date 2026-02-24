---
name: topology-pipeline
description: Apply a sequential pipeline topology. Creates Agent A -> Agent B -> Agent C chain where each stage processes and passes to next. Use when user says "topology pipeline", "sequential agents", "processing pipeline", "chain of agents", or wants ordered multi-step processing.
---

# Topology: Pipeline

Apply a sequential pipeline topology where agents execute in a fixed order. Each stage processes data and passes results to the next stage. Good for ETL workflows, document processing chains, approval flows, and any ordered multi-step process.

## What This Creates

```
  +----------+      +----------+      +----------+      +----------+
  |  Stage 1 | ---> |  Stage 2 | ---> |  Stage 3 | ---> |   ...    | ---> END
  | (agent)  |      | (agent)  |      | (agent)  |      | (agent)  |
  +----------+      +----------+      +----------+      +----------+

  State carries: current_stage, stage_index, pipeline_data, stage_results
  Each stage reads pipeline_data, processes, appends to stage_results
```

## Prerequisites

- The user must have run `/init` (or manually set up a LangGraph project with `state.py`, `graph.py`, `langgraph.json`)
- The project root must contain `state.py` with a `BaseState` TypedDict
- The project root must contain `graph.py` with a StateGraph

## Parameters

Ask the user for:

1. **Project root** -- Confirm by checking for `state.py` and `graph.py`.
2. **Number of stages** -- How many stages in the pipeline (minimum 2).
3. **For each stage**, ask:
   - **Name** -- Snake_case identifier (e.g., `extract`, `transform`, `load`, `validate`, `enrich`)
   - **Purpose** -- What this stage does (used in the agent system prompt and docstring)
   - **Model** (optional) -- LLM model override for this stage (default: project default)
   - **Has tools?** (optional) -- Whether this stage needs tool access (creates a ReAct loop) or is a simple LLM call

## Workflow

### Step 1: Verify project structure

Confirm these files exist in the project root:
- `state.py`
- `graph.py`
- `langgraph.json`
- `config/settings.py`

### Step 2: Copy library patterns into the project

Copy the pipeline pattern from AOD Engine library into the project:

```
{project_root}/
  library/
    __init__.py
    patterns/
      __init__.py
      pipeline_node.py        <-- from aod-engine/library/patterns/pipeline_node.py
    state/
      __init__.py
      pipeline_state.py       <-- from aod-engine/library/state/pipeline_state.py
```

Source files are at `library/`. Read each one and write it into the project.

If `library/` already exists (from another topology), merge -- do not overwrite existing files.

### Step 3: Extend state.py with pipeline fields

Add pipeline state fields to `BaseState` in `state.py`:

```python
"""State for pipeline multi-agent system."""

from typing import Any, Dict, List, Optional, Annotated

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class BaseState(TypedDict):
    """State with pipeline tracking fields."""

    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    metadata: Dict[str, Any]

    # Pipeline fields (added by /topology pipeline)
    current_stage: str
    stage_index: int
    pipeline_data: Dict[str, Any]
    stage_results: List[Dict[str, Any]]
    pipeline_complete: bool
```

Merge these fields into the existing BaseState. Do NOT remove any existing fields.

### Step 4: Create agent files for each stage

For each stage the user specified, create `{project_root}/agents/{stage_name}.py`:

```python
"""Pipeline stage: {stage_name} -- {purpose}."""

from typing import Any, Dict

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage

from config.settings import settings
from state import BaseState


SYSTEM_PROMPT = """{purpose_description}

You are stage {index + 1} of {total_stages} in a processing pipeline.
Your job is to {purpose}.

Input data is in the pipeline_data field of the state.
Previous stage results are in stage_results.
Process the data and return your results."""


async def {stage_name}(state: BaseState) -> Dict[str, Any]:
    """Process stage: {stage_name}."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)

    # Build context from pipeline data and previous results
    pipeline_data = state.get("pipeline_data", {})
    previous_results = state.get("stage_results", [])

    context = f"Pipeline data: {pipeline_data}\n"
    if previous_results:
        context += f"Previous stage results: {previous_results}\n"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": context},
    ]

    response = await llm.ainvoke(messages)

    # Update state
    stage_results = list(previous_results)
    stage_results.append({
        "stage": "{stage_name}",
        "result": response.content,
    })

    return {
        "current_stage": "{stage_name}",
        "stage_index": {index},
        "stage_results": stage_results,
        "messages": [AIMessage(content=response.content)],
    }
```

Also create `{project_root}/agents/__init__.py` with imports for all stage functions.

### Step 5: Rewrite graph.py

Replace `graph.py` with the sequential pipeline:

```python
"""Main graph -- pipeline topology with sequential stages."""

from langgraph.graph import END, StateGraph

from state import BaseState
from agents.{stage_1} import {stage_1}
from agents.{stage_2} import {stage_2}
# ... import all stages

# Build the graph
builder = StateGraph(BaseState)

# Add all stage nodes
builder.add_node("{stage_1}", {stage_1})
builder.add_node("{stage_2}", {stage_2})
# ... add all stages

# Wire sequential edges
builder.set_entry_point("{stage_1}")
builder.add_edge("{stage_1}", "{stage_2}")
builder.add_edge("{stage_2}", "{stage_3}")
# ... wire all sequential edges
builder.add_edge("{last_stage}", END)

# Compile
graph = builder.compile()
```

Use the actual stage names provided by the user.

### Step 6: Update main.py

Update `main.py` to initialize pipeline state properly:

```python
result = await graph.ainvoke(
    {
        "messages": [{"role": "user", "content": user_input}],
        "session_id": session_id,
        "metadata": {},
        "current_stage": "",
        "stage_index": 0,
        "pipeline_data": {"input": user_input},
        "stage_results": [],
        "pipeline_complete": False,
    }
)
```

### Step 7: Report what was created

Tell the user:

```
Pipeline topology applied successfully.

Pipeline: {stage_1} -> {stage_2} -> {stage_3} -> ... -> END

Files created:
  agents/{stage_1}.py         -- Stage 1: {purpose_1}
  agents/{stage_2}.py         -- Stage 2: {purpose_2}
  agents/{stage_3}.py         -- Stage 3: {purpose_3}
  ...
  agents/__init__.py
  library/patterns/pipeline_node.py
  library/state/pipeline_state.py

Files modified:
  state.py                    -- Added pipeline fields to BaseState
  graph.py                    -- Rewired as sequential pipeline
  main.py                     -- Updated initial state with pipeline fields

To add a new stage later, create agents/{name}.py and add it to graph.py.
Each stage receives pipeline_data and previous stage_results via state.
```

## Files Created

| File | Purpose |
|------|---------|
| `agents/{stage_name}.py` (one per stage) | Processing logic for each pipeline stage |
| `agents/__init__.py` | Package with stage imports |
| `library/patterns/pipeline_node.py` | Pipeline pattern reference |
| `library/state/pipeline_state.py` | Pipeline state reference |

## Files Modified

| File | Changes |
|------|---------|
| `state.py` | Added pipeline fields: `current_stage`, `stage_index`, `pipeline_data`, `stage_results`, `pipeline_complete` |
| `graph.py` | Replaced with sequential pipeline: stage1 -> stage2 -> ... -> END |
| `main.py` | Updated initial state to include pipeline fields |

## Example Usage

```
User: /topology pipeline
Claude: How many stages does your pipeline need?
User: 3 stages: extract (scrape data from URLs), transform (clean and normalize), load (save to database)
Claude: [Creates agents/extract.py, agents/transform.py, agents/load.py]
        [Wires: extract -> transform -> load -> END]
        Pipeline topology applied. Edit each agent's SYSTEM_PROMPT to refine behavior.
```

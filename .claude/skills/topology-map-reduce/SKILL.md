---
name: topology-map-reduce
description: Apply a map-reduce topology. Creates fan-out node that distributes work to parallel workers, then an aggregator that merges results. Use when user says "topology map-reduce", "parallel processing", "fan-out fan-in", "map reduce", or wants work distributed across multiple workers and combined.
---

# Topology: Map-Reduce

Apply a map-reduce topology where work is fanned out to parallel workers and then aggregated. A fan-out node distributes tasks, multiple workers process in parallel, and an aggregator merges the results.

## What This Creates

```
                    +----------+
                    |  Fan Out |
                    | (splits) |
                    +--+--+--+-+
                       |  |  |
              +--------+  |  +--------+
              |           |           |
         +----v----+ +----v----+ +----v----+
         | Worker  | | Worker  | | Worker  |
         |    A    | |    B    | |    C    |
         +----+----+ +----+----+ +----+----+
              |           |           |
              +--------+  |  +--------+
                       |  |  |
                    +--v--v--v-+
                    |Aggregator|
                    | (merges) |
                    +----+-----+
                         |
                        END

  Fan-out distributes work -> Workers process in parallel -> Aggregator combines
```

## Prerequisites

- The user must have run `/init` (or manually set up a LangGraph project with `state.py`, `graph.py`, `langgraph.json`)
- The project root must contain `state.py` with a `BaseState` TypedDict
- The project root must contain `graph.py` with a StateGraph

## Parameters

Ask the user for:

1. **Project root** -- Confirm by checking for `state.py` and `graph.py`.
2. **What is being distributed** -- What kind of work gets split (e.g., "document chunks", "search queries", "analysis dimensions")
3. **Workers** -- For each worker:
   - **Name** -- Snake_case identifier (e.g., `sentiment_worker`, `entity_worker`, `summary_worker`)
   - **Purpose** -- What this worker processes
4. **Aggregation strategy** -- How results are combined (e.g., "concatenate", "vote", "merge fields", "weighted average")

## Workflow

### Step 1: Verify project structure

Confirm `state.py`, `graph.py`, `langgraph.json`, `config/settings.py` exist.

### Step 2: Copy library patterns

Copy from AOD Engine library:

```
{project_root}/
  library/
    __init__.py
    patterns/
      __init__.py
      aggregator.py           <-- from aod-engine/library/patterns/aggregator.py
```

Source: `library/` (AOD Engine library). Merge with existing `library/` if present.

### Step 3: Extend state.py

Add map-reduce state fields to `BaseState`:

```python
    # Map-reduce fields (added by /topology map-reduce)
    work_items: List[Dict[str, Any]]
    worker_results: Dict[str, Any]
    aggregated_result: Optional[str]
    fan_out_complete: bool
    aggregation_complete: bool
```

Merge into existing BaseState.

### Step 4: Create the fan-out node

Create `{project_root}/fan_out.py`:

```python
"""Fan-out node -- distributes work to parallel workers."""

from typing import Any, Dict, List

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage
from pydantic import BaseModel, Field

from config.settings import settings
from state import BaseState


class WorkDistribution(BaseModel):
    """Structured output for work distribution."""

    items: List[Dict[str, str]] = Field(
        description="List of work items, each with 'worker' and 'task' keys"
    )
    strategy: str = Field(description="How work was divided")


SYSTEM_PROMPT = """You are a work distributor. Break the user's request into
parallel tasks for the available workers.

Available workers:
{workers_description}

Create a work item for each worker that is relevant to the request.
Each work item should be a specific, focused sub-task."""


async def fan_out(state: BaseState) -> Dict[str, Any]:
    """Distribute work to parallel workers."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)
    structured_llm = llm.with_structured_output(WorkDistribution)

    messages = state.get("messages", [])
    last_message = messages[-1] if messages else None
    user_text = last_message.content if last_message and hasattr(last_message, "content") else ""

    workers_desc = "\\n".join(f"- {name}: {purpose}" for name, purpose in WORKERS.items())

    result = await structured_llm.ainvoke([
        {"role": "system", "content": SYSTEM_PROMPT.format(workers_description=workers_desc)},
        {"role": "user", "content": user_text},
    ])

    work_items = []
    for item in result.items:
        work_items.append(item)

    return {
        "work_items": work_items,
        "fan_out_complete": True,
        "worker_results": {},
    }


# Worker registry -- populated by graph.py
WORKERS: Dict[str, str] = {}
```

### Step 5: Create worker agents

For each worker, create `{project_root}/agents/{name}.py`:

```python
"""Map-reduce worker: {name} -- {purpose}."""

from typing import Any, Dict

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage

from config.settings import settings
from state import BaseState


SYSTEM_PROMPT = """You are {name}, a worker that specializes in {purpose}.

You receive a specific sub-task from the fan-out distributor.
Process it thoroughly and return a clear, structured result.
Your output will be combined with other workers' results by the aggregator."""


async def {name}(state: BaseState) -> Dict[str, Any]:
    """Process assigned work item."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)

    messages = state.get("messages", [])
    work_items = state.get("work_items", [])

    # Find this worker's task
    my_task = ""
    for item in work_items:
        if item.get("worker") == "{name}":
            my_task = item.get("task", "")
            break

    if not my_task:
        my_task = "Process the overall request from your area of expertise."

    response = await llm.ainvoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Your assigned task: {my_task}"},
    ])

    # Store result
    worker_results = dict(state.get("worker_results", {}))
    worker_results["{name}"] = response.content

    return {
        "worker_results": worker_results,
    }
```

Create `{project_root}/agents/__init__.py`.

### Step 6: Create the aggregator node

Create `{project_root}/aggregator.py`:

```python
"""Aggregator node -- merges results from parallel workers."""

from typing import Any, Dict

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage

from config.settings import settings
from state import BaseState


AGGREGATION_STRATEGY = "{aggregation_strategy}"

SYSTEM_PROMPT = """You are the aggregator. Multiple workers have processed parts of a request in parallel.

Aggregation strategy: {strategy}

Worker results:
{results}

Combine these results into a single, coherent response.
Follow the aggregation strategy."""


async def aggregator(state: BaseState) -> Dict[str, Any]:
    """Aggregate worker results into final output."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)

    worker_results = state.get("worker_results", {})

    results_text = ""
    for name, result in worker_results.items():
        results_text += f"\\n[{name}]:\\n{result}\\n"

    response = await llm.ainvoke([
        {"role": "system", "content": SYSTEM_PROMPT.format(
            strategy=AGGREGATION_STRATEGY,
            results=results_text,
        )},
        {"role": "user", "content": "Aggregate the worker results now."},
    ])

    return {
        "aggregated_result": response.content,
        "aggregation_complete": True,
        "messages": [AIMessage(content=response.content)],
    }
```

### Step 7: Rewrite graph.py

```python
"""Main graph -- map-reduce topology with fan-out, workers, and aggregator."""

from langgraph.graph import END, StateGraph

from state import BaseState
from fan_out import fan_out, WORKERS
from aggregator import aggregator
from agents.{worker_1} import {worker_1}
from agents.{worker_2} import {worker_2}
# ... import all workers

# Register workers
WORKERS.update({
    "{worker_1}": "{purpose_1}",
    "{worker_2}": "{purpose_2}",
    # ... etc
})

# Build graph
builder = StateGraph(BaseState)

# Fan-out distributes work
builder.add_node("fan_out", fan_out)
builder.set_entry_point("fan_out")

# Add worker nodes -- all run after fan_out (parallel fan-out)
builder.add_node("{worker_1}", {worker_1})
builder.add_node("{worker_2}", {worker_2})
# ... etc

# Fan-out edges to all workers (parallel)
builder.add_edge("fan_out", "{worker_1}")
builder.add_edge("fan_out", "{worker_2}")
# ... etc

# Aggregator collects results
builder.add_node("aggregator", aggregator)

# All workers feed into aggregator
builder.add_edge("{worker_1}", "aggregator")
builder.add_edge("{worker_2}", "aggregator")
# ... etc

# Aggregator ends the graph
builder.add_edge("aggregator", END)

# Compile
graph = builder.compile()
```

### Step 8: Update main.py

```python
result = await graph.ainvoke(
    {
        "messages": [{"role": "user", "content": user_input}],
        "session_id": session_id,
        "metadata": {},
        "work_items": [],
        "worker_results": {},
        "aggregated_result": None,
        "fan_out_complete": False,
        "aggregation_complete": False,
    }
)
```

### Step 9: Report results

```
Map-reduce topology applied successfully.

Flow: fan_out -> [{worker_1}, {worker_2}, ...] (parallel) -> aggregator -> END
Aggregation strategy: {aggregation_strategy}

Files created:
  fan_out.py                  -- Distributes work to workers
  aggregator.py               -- Merges worker results
  agents/{worker_1}.py        -- {purpose_1}
  agents/{worker_2}.py        -- {purpose_2}
  ...
  agents/__init__.py

Files modified:
  state.py                    -- Added map-reduce fields
  graph.py                    -- Rewired as fan-out -> parallel workers -> aggregator
  main.py                     -- Updated initial state

Workers run in parallel. Aggregator waits for all results before combining.
```

## Files Created

| File | Purpose |
|------|---------|
| `fan_out.py` | Distributes work items to workers |
| `aggregator.py` | Merges parallel worker results |
| `agents/{name}.py` (per worker) | Individual worker |
| `library/patterns/aggregator.py` | Aggregator pattern reference |

## Files Modified

| File | Changes |
|------|---------|
| `state.py` | Added: `work_items`, `worker_results`, `aggregated_result`, `fan_out_complete`, `aggregation_complete` |
| `graph.py` | Rewritten with fan-out -> parallel workers -> aggregator |
| `main.py` | Updated initial state with map-reduce fields |

## Example Usage

```
User: /topology map-reduce
Claude: What kind of work gets distributed across workers?
User: Document analysis -- I want to analyze documents for sentiment, entities, and key topics in parallel
Claude: [Creates sentiment_worker, entity_worker, topic_worker]
        How should results be aggregated? (concatenate, merge, summary)
User: Merge into a structured report
Claude: [Creates fan_out.py, aggregator.py, 3 workers]
        [fan_out -> sentiment_worker + entity_worker + topic_worker -> aggregator -> END]
```

---
name: add-observability
description: Add LangSmith observability and tracing to the project. Configures environment variables, tracing setup, and optional custom callbacks. Use when user says "add observability", "add tracing", "add langsmith", "add monitoring", or wants to monitor agent behavior.
---

# Add Observability

Add LangSmith tracing and observability to the LangGraph project. This enables full visibility into agent decisions, tool calls, token usage, and latency.

## What This Adds

- LangSmith environment configuration (API key, project name, tracing flag)
- Tracing is automatically enabled via environment variables (LangGraph/LangChain native)
- Optional: custom callback handler for additional metrics
- Optional: run metadata tagging for filtering traces

## Prerequisites

- A project initialized with `/init` (any topology)
- A LangSmith account (https://smith.langchain.com)
- LangSmith API key

## Parameters

Ask the user for:

1. **LangSmith project name** (optional) -- Defaults to the project directory name
2. **Custom callbacks** (optional) -- Whether to add a custom callback handler for extra metrics
3. **Run metadata** (optional) -- Default metadata tags for all runs

## Workflow

### Step 1: Update environment configuration

Edit `.env.example` to add LangSmith variables:

```bash
# --- LangSmith Observability ---
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your-langsmith-api-key
LANGCHAIN_PROJECT={project_name}
LANGCHAIN_ENDPOINT=https://api.smith.langchain.com
```

If `.env` exists, add the same variables (with placeholder values).

### Step 2: Update settings

Edit `config/settings.py` to add LangSmith settings:

```python
# LangSmith
langsmith_tracing: bool = True
langsmith_api_key: str = ""
langsmith_project: str = "{project_name}"
langsmith_endpoint: str = "https://api.smith.langchain.com"
```

Check if these fields already exist (the template may include them). If they do, ensure they're properly configured.

### Step 3: Add tracing initialization

Edit `main.py` to add tracing setup at startup:

```python
import os

def setup_tracing():
    """Configure LangSmith tracing from settings."""
    from config.settings import settings

    if settings.langsmith_tracing and settings.langsmith_api_key:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"] = settings.langsmith_api_key
        os.environ["LANGCHAIN_PROJECT"] = settings.langsmith_project
        os.environ["LANGCHAIN_ENDPOINT"] = settings.langsmith_endpoint
        print(f"LangSmith tracing enabled for project: {settings.langsmith_project}")
    else:
        os.environ["LANGCHAIN_TRACING_V2"] = "false"
        print("LangSmith tracing disabled (no API key or tracing=false)")
```

Call `setup_tracing()` at the beginning of `main()` or the FastAPI lifespan.

### Step 4: Add dependencies

Add to `pyproject.toml` dependencies:

```
langsmith>=0.1.0
```

This is the LangSmith client SDK. LangChain and LangGraph automatically use it when `LANGCHAIN_TRACING_V2=true`.

### Step 5: (Optional) Custom callback handler

If the user wants custom metrics, create `observability/callbacks.py`:

```python
"""Custom LangSmith callback handler for additional metrics."""

from typing import Any, Dict, List, Optional
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult


class MetricsCallbackHandler(BaseCallbackHandler):
    """Tracks custom metrics alongside LangSmith traces."""

    def __init__(self):
        self.total_tokens = 0
        self.total_calls = 0
        self.tool_calls = 0
        self.errors = 0

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Track LLM usage."""
        self.total_calls += 1
        if response.llm_output:
            usage = response.llm_output.get("token_usage", {})
            self.total_tokens += usage.get("total_tokens", 0)

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """Track tool invocations."""
        self.tool_calls += 1

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        """Track errors."""
        self.errors += 1

    def get_metrics(self) -> Dict[str, int]:
        """Return current metrics."""
        return {
            "total_llm_calls": self.total_calls,
            "total_tokens": self.total_tokens,
            "tool_calls": self.tool_calls,
            "errors": self.errors,
        }


# Singleton for project-wide use
metrics = MetricsCallbackHandler()
```

### Step 6: (Optional) Run metadata

If the user wants default metadata on all runs, add to the graph invocation:

```python
config = {
    "metadata": {
        "environment": settings.environment,
        "version": "1.0.0",
        # Add custom tags
    },
    "tags": ["production", "{project_name}"],
}

result = await graph.ainvoke(state, config=config)
```

### Step 7: Report results

```
Observability configured with LangSmith.

Configuration:
  LANGCHAIN_TRACING_V2=true
  LANGCHAIN_PROJECT={project_name}

Files modified:
  .env.example            -- Added LangSmith variables
  config/settings.py      -- Added LangSmith settings
  main.py                 -- Added tracing initialization
  pyproject.toml          -- Added langsmith dependency

{if custom_callbacks}
Files created:
  observability/callbacks.py -- Custom metrics callback handler
{end if}

Setup:
  1. Get your API key from https://smith.langchain.com
  2. Set LANGCHAIN_API_KEY in your .env file
  3. Run the project -- traces will appear in LangSmith dashboard

Dashboard: https://smith.langchain.com/o/{org}/projects/p/{project_name}
```

## Files Modified

| File | Changes |
|------|---------|
| `.env.example` | Added LANGCHAIN_TRACING_V2, API_KEY, PROJECT, ENDPOINT |
| `config/settings.py` | Added langsmith_* settings fields |
| `main.py` | Added setup_tracing() call |
| `pyproject.toml` | Added langsmith dependency |

## Files Created (Optional)

| File | Purpose |
|------|---------|
| `observability/__init__.py` | Package init |
| `observability/callbacks.py` | Custom metrics callback handler |

## Example Usage

```
User: /add-observability
Claude: What LangSmith project name? (default: my-project)
User: my-agent-system
Claude: Want custom callback metrics? (token tracking, error counting)
User: Yes
Claude: [Configures .env, settings, tracing init]
        [Creates observability/callbacks.py]

        Observability enabled. Set LANGCHAIN_API_KEY in .env and traces
        will appear at smith.langchain.com.
```

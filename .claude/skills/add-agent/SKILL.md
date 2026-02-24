---
name: add-agent
description: "Add a full agent node with LLM, tools, and ReAct loop to the LangGraph graph. Triggers on \"add agent\", \"new agent\", \"create agent\", \"add an agent\", \"add llm agent\"."
---

# Add Agent

Add a complete agent node to the graph. This is a higher-level skill that combines several primitives: it creates an agent function with LLM invocation, optionally creates tools, sets up the ReAct tool-calling loop, and registers everything in `graph.py`. This is the preferred way to add an LLM-powered node.

## Prerequisites

- An initialized AOD Engine project with `graph.py`, `state.py`, and `.aod/state.yaml`.
- The `agents/` and `tools/` directories must exist.

## Parameters

Gather these from the user. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `agent_name` | Yes | — | Snake_case name for the agent (e.g., `research_agent`, `code_reviewer`). |
| `system_prompt` | Yes | — | System prompt that defines the agent's role and behavior. |
| `llm_model` | No | (from settings) | Model identifier override (e.g., `gpt-4o`, `claude-sonnet-4-20250514`, `gemini-2.0-flash`). If not provided, uses `settings.default_model`. |
| `tools` | No | `[]` | List of tool names to create and bind. For each tool, ask for: name, description, and optionally input parameters. |
| `temperature` | No | `0.7` | LLM temperature setting. |

## Workflow

### 1. Validate Parameters

- `agent_name` must be a valid Python identifier (snake_case).
- `agent_name` must not already exist in `graph.py` or `agents/`.
- If tools are specified, validate each tool name is a valid Python identifier and does not already exist in `tools/`.

### 2. Determine LLM Provider

Read `.aod/state.yaml` to get the project's `llm_provider`. This determines the import and class:

| Provider | Import | Class | Model Default |
|----------|--------|-------|---------------|
| openai | `from langchain_openai import ChatOpenAI` | `ChatOpenAI` | `gpt-4o-mini` |
| google | `from langchain_google_genai import ChatGoogleGenerativeAI` | `ChatGoogleGenerativeAI` | `gemini-2.0-flash` |
| anthropic | `from langchain_anthropic import ChatAnthropic` | `ChatAnthropic` | `claude-sonnet-4-20250514` |

If the user specified `llm_model`, use that. Otherwise use the provider's default from `settings.default_model`.

### 3. Create Tools (if specified)

For each tool in the `tools` list, create the tool file following the same process as the `/add-tool` skill:

Create `tools/{tool_name}.py` with the `@tool` decorator:

```python
"""Tool: {tool_name} — {tool_description}"""

from langchain_core.tools import tool


@tool
def {tool_name}(input: str) -> str:
    """{tool_description}"""
    # TODO: Implement tool logic
    raise NotImplementedError("Implement {tool_name}")
```

If the user provides input parameters for a tool, use `args_schema` with a Pydantic model (same as `/add-tool`).

### 4. Create Agent File

Create `agents/{agent_name}.py`:

```python
"""Agent: {agent_name}

{system_prompt}
"""

from typing import Any, Dict, List

from langchain_core.messages import BaseMessage, SystemMessage
{llm_import}
from config import settings
{tool_imports}


SYSTEM_PROMPT = """{system_prompt}"""

{if tools:}
# Tools available to this agent
tools = [{tool_names_comma_separated}]
{end if}


async def {agent_name}(state: Dict[str, Any]) -> Dict[str, Any]:
    """Agent node that invokes the LLM{' with tools' if tools else ''}.

    Reads messages from state, prepends the system prompt,
    invokes the LLM, and returns the response.
    """
{if llm_model:}
    llm = {LLMClass}(model="{llm_model}", temperature={temperature})
{else:}
    llm = {LLMClass}(model=settings.default_model, temperature={temperature})
{end if}
{if tools:}
    llm = llm.bind_tools(tools)
{end if}

    messages = state.get("messages", [])

    # Prepend system prompt if not already present
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)

    response = await llm.ainvoke(messages)
    return {"messages": [response]}
```

Where:
- `{llm_import}` is the appropriate import for the provider.
- `{tool_imports}` is one import line per tool: `from tools.{tool_name} import {tool_name}`.
- `{LLMClass}` is the class name for the provider.
- `{tool_names_comma_separated}` is the tools joined by commas.

### 5. Modify graph.py -- Add Agent Node

**Add import:**

```python
from agents.{agent_name} import {agent_name}
```

**Add node:**

```python
builder.add_node("{agent_name}", {agent_name})
```

### 6. Set Up Tool Loop (if tools exist)

If the agent has tools, the ReAct pattern requires:
1. A tool executor node.
2. A conditional edge from the agent to the tool executor (when tool calls are present).
3. A fixed edge from the tool executor back to the agent.

**Check if a shared tool executor already exists** in `graph.py`. Search for `ToolNode` usage.

**If no tool executor exists for this agent, create one:**

Add to `graph.py` (inline, not as a separate file, since it is tightly coupled):

```python
from langgraph.prebuilt import ToolNode
from agents.{agent_name} import tools as {agent_name}_tools

{agent_name}_tool_executor = ToolNode({agent_name}_tools)
builder.add_node("{agent_name}_tools", {agent_name}_tool_executor)
```

Also export the tools list from the agent file. Add this to `agents/{agent_name}.py` if not already present:

```python
# At module level, the 'tools' list is already defined above
```

**Add the should_continue function** (if not already in `graph.py`):

```python
from typing import Literal

def should_continue_{agent_name}(state: Dict[str, Any]) -> Literal["tools", "end"]:
    """Check if {agent_name} wants to call tools or finish."""
    messages = state.get("messages", [])
    if not messages:
        return "end"
    last_message = messages[-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "end"
```

If there is already a generic `should_continue` function in `graph.py`, reuse it instead of creating a duplicate. A single `should_continue` works for all agents since the logic is the same (check last message for tool_calls).

**Add conditional edge:**

```python
builder.add_conditional_edges(
    "{agent_name}",
    should_continue,
    {"tools": "{agent_name}_tools", "end": END},
)
```

**Add return edge:**

```python
builder.add_edge("{agent_name}_tools", "{agent_name}")
```

### 7. If No Tools

If the agent has no tools, skip the tool executor setup. The agent is a simple LLM node. Only the node registration from step 5 is needed. The user will wire edges to and from this node using `/add-edge`.

### 8. Update .aod/state.yaml

Add the agent:

```yaml
agents:
  - name: "{agent_name}"
    file: "agents/{agent_name}.py"
    model: "{llm_model or default}"
    tools: [{tool_names}]
    system_prompt_preview: "{first 80 chars of system_prompt}..."
```

Add each tool:

```yaml
tools:
  - name: "{tool_name}"
    file: "tools/{tool_name}.py"
    agent: "{agent_name}"
    description: "{tool_description}"
```

Add nodes:

```yaml
graph:
  nodes:
    - name: "{agent_name}"
      type: agent
      file: "agents/{agent_name}.py"
      description: "LLM agent: {first 50 chars of system_prompt}"
    # If tools exist:
    - name: "{agent_name}_tools"
      type: tool_executor
      file: null
      description: "Tool executor for {agent_name}"
```

Add edges (if tools exist):

```yaml
graph:
  edges:
    - source: "{agent_name}"
      target: null
      type: conditional
      condition: "should_continue"
      routes:
        "tools": "{agent_name}_tools"
        "end": "__end__"
    - source: "{agent_name}_tools"
      target: "{agent_name}"
      type: fixed
```

### 9. Report to User

Tell the user:
- Created `agents/{agent_name}.py` with system prompt and LLM configuration.
- Created tool files (if any): list each `tools/{tool_name}.py`.
- Added the agent as a node in `graph.py`.
- If tools exist: set up the full ReAct loop (agent -> should_continue -> tools -> agent).
- The agent is NOT yet set as the entry point. Use `/add-entry-point` if this should be the starting node.
- The agent is NOT yet connected to other nodes (except its own tool loop). Use `/add-edge` to wire it into the broader graph.
- List any TODO items in the tool files that need implementation.

## File Changes

**Created:**
- `agents/{agent_name}.py` -- agent node function with LLM and system prompt
- `tools/{tool_name}.py` (one per tool) -- tool functions with `@tool` decorator

**Modified:**
- `graph.py` -- added imports, agent node, tool executor node (if tools), conditional edges (if tools), return edge (if tools), possibly `should_continue` function
- `.aod/state.yaml` -- added agent, tools, nodes, and edges

## Example

User: "Add an agent called research_agent with system prompt 'You are a research assistant. Find and summarize information.' and tools: web_search, summarize"

Result:
- Created `agents/research_agent.py`:
  ```python
  SYSTEM_PROMPT = """You are a research assistant. Find and summarize information."""

  tools = [web_search, summarize]

  async def research_agent(state):
      llm = ChatOpenAI(model=settings.default_model, temperature=0.7).bind_tools(tools)
      messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(state.get("messages", []))
      response = await llm.ainvoke(messages)
      return {"messages": [response]}
  ```
- Created `tools/web_search.py` and `tools/summarize.py` with TODO implementations.
- Modified `graph.py`:
  - Added `research_agent` node.
  - Added `research_agent_tools` tool executor node.
  - Added conditional edge: `research_agent` -> `should_continue` -> `{tools: research_agent_tools, end: END}`.
  - Added return edge: `research_agent_tools` -> `research_agent`.
- Updated `.aod/state.yaml` with all new entries.
- Informed user to set entry point with `/add-entry-point` and implement the tool functions.

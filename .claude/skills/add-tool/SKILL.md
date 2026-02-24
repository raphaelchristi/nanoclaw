---
name: add-tool
description: "Add a tool to an agent in the LangGraph graph. Creates a @tool decorated function and wires it to an agent. Triggers on \"add tool\", \"new tool\", \"create tool\", \"give agent a tool\", \"add function tool\"."
---

# Add Tool to Agent

Create a LangChain tool (a `@tool` decorated function) and wire it to an existing agent node. Tools give agents the ability to call external functions, APIs, databases, and other services.

## Prerequisites

- An initialized AOD Engine project with `graph.py` and `.aod/state.yaml`.
- The `tools/` directory must exist.
- The target agent node must already exist (created via `/add-node` or `/add-agent`).

## Parameters

Gather these from the user. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `tool_name` | Yes | — | Snake_case name for the tool (e.g., `web_search`, `calculate`, `fetch_document`). |
| `agent_name` | Yes | — | Name of the agent node that will use this tool. |
| `description` | Yes | — | Clear description of what the tool does. This is shown to the LLM so it knows when to call the tool. |
| `input_schema` | No | — | Input parameters as a list of `{name, type, description}` dicts. If not provided, create a simple string input. |
| `output_type` | No | `str` | Return type of the tool function. |

### Tool Description Best Practices

The `description` is critical -- it is what the LLM reads to decide whether and when to call the tool. Guide the user:

- Be specific: "Search the web using Google" not "Search".
- Include when to use it: "Use this when the user asks about current events or needs up-to-date information."
- Include what it returns: "Returns a list of search result snippets with titles and URLs."

## Workflow

### 1. Validate Parameters

- `tool_name` must be a valid Python identifier (snake_case).
- `tool_name` must not already exist in `tools/`. Check for `tools/{tool_name}.py`.
- `agent_name` must exist in the graph. Read `graph.py` and verify `builder.add_node("{agent_name}", ...)` exists.
- Read `.aod/state.yaml` to verify the agent node exists.

### 2. Create Tool File

Create `tools/{tool_name}.py`:

**If input_schema is provided:**

```python
"""Tool: {tool_name} — {description}"""

from langchain_core.tools import tool
from pydantic import BaseModel, Field


class {ToolNamePascalCase}Input(BaseModel):
    """{description} input schema."""

{for each param in input_schema:}
    {param.name}: {param.type} = Field(description="{param.description}")


@tool(args_schema={ToolNamePascalCase}Input)
def {tool_name}({param_args}) -> {output_type}:
    """{description}"""
    # TODO: Implement tool logic
    raise NotImplementedError("Implement {tool_name}")
```

Where `{ToolNamePascalCase}` is the PascalCase version of the tool name (e.g., `web_search` becomes `WebSearch`), and `{param_args}` is the function signature derived from the schema (e.g., `query: str, max_results: int = 10`).

**If input_schema is NOT provided (simple tool):**

```python
"""Tool: {tool_name} — {description}"""

from langchain_core.tools import tool


@tool
def {tool_name}(input: str) -> {output_type}:
    """{description}"""
    # TODO: Implement tool logic
    raise NotImplementedError("Implement {tool_name}")
```

**Important:** The `@tool` decorator uses the function's docstring as the tool description shown to the LLM. Make sure the docstring is the `description` parameter provided by the user.

### 3. Modify the Agent File

Locate the agent's source file. Check these locations in order:
1. `agents/{agent_name}.py` (if created via `/add-agent`)
2. `nodes/{agent_name}.py` (if created via `/add-node`)
3. `graph.py` itself (if the agent function is defined inline)

Once found, make these changes:

**Add import** at the top of the agent file:

```python
from tools.{tool_name} import {tool_name}
```

**Add tool to the tools list.** Find where tools are defined or used. Common patterns:

Pattern A -- Tools list variable:
```python
# Before
tools = [existing_tool]

# After
tools = [existing_tool, {tool_name}]
```

Pattern B -- Tools bound to LLM:
```python
# Before
llm = ChatOpenAI(model=settings.default_model)

# After
from tools.{tool_name} import {tool_name}
tools = [{tool_name}]
llm = ChatOpenAI(model=settings.default_model).bind_tools(tools)
```

Pattern C -- No tools yet (first tool being added):
```python
# Add tools list before the LLM invocation
from tools.{tool_name} import {tool_name}

tools = [{tool_name}]
llm = ChatOpenAI(model=settings.default_model).bind_tools(tools)
```

If the agent does not yet call `.bind_tools()` on its LLM, add it. The LLM must know about the tools to generate tool calls.

### 4. Handle Tool Executor Node

For the agent's tool calls to actually execute, there must be a tool executor node that runs the tools. Check if one already exists:

- Search `graph.py` for a `ToolNode` or `tool_executor` node.
- Check if there is already a conditional edge from the agent to a tool executor.

**If no tool executor exists:**

Tell the user:

> The tool `{tool_name}` has been created and bound to the agent `{agent_name}`. However, there is no tool executor node to run the tools. You need to:
> 1. Run `/add-node` to create a `tool_executor` node of type `tool_executor`.
> 2. Run `/add-edge` to create a conditional edge from `{agent_name}` to `tool_executor` (using the `should_continue` pattern).
> 3. Run `/add-edge` to create a fixed edge from `tool_executor` back to `{agent_name}` (completing the ReAct loop).

**If a tool executor already exists:**

Update the tool executor's tools list. Find the `ToolNode(tools)` or equivalent and add the new tool:

```python
from tools.{tool_name} import {tool_name}

# In the tool executor file:
tools = [existing_tool, {tool_name}]
tool_executor = ToolNode(tools)
```

The tool executor's tools list must include ALL tools that any connected agent might call.

### 5. Update .aod/state.yaml

Add the tool to the `tools` list:

```yaml
tools:
  - name: "{tool_name}"
    file: "tools/{tool_name}.py"
    agent: "{agent_name}"
    description: "{description}"
```

### 6. Report to User

Tell the user:
- Created `tools/{tool_name}.py` with the tool function.
- Updated the agent file to import and bind the tool.
- Whether a tool executor node exists or needs to be created.
- The tool has a TODO that needs implementation.
- How the tool appears to the LLM (via the docstring description).

## File Changes

**Created:**
- `tools/{tool_name}.py` -- tool function with `@tool` decorator

**Modified:**
- Agent file (`agents/{agent_name}.py` or `nodes/{agent_name}.py`) -- added import, added tool to tools list, ensured `.bind_tools()` is called
- Tool executor file (if exists) -- added tool to the ToolNode's tools list
- `.aod/state.yaml` -- added tool to tools list

## Example

User: "Add a web_search tool to the research_agent with parameters query (str) and max_results (int, default 5)"

Result:
- Created `tools/web_search.py`:
  ```python
  from langchain_core.tools import tool
  from pydantic import BaseModel, Field

  class WebSearchInput(BaseModel):
      query: str = Field(description="Search query string")
      max_results: int = Field(default=5, description="Maximum number of results to return")

  @tool(args_schema=WebSearchInput)
  def web_search(query: str, max_results: int = 5) -> str:
      """Search the web for current information. Use when the user asks about recent events or needs up-to-date data. Returns search result snippets."""
      raise NotImplementedError("Implement web_search")
  ```
- Updated `agents/research_agent.py` to import and bind the tool.
- Informed user about the tool executor requirement.

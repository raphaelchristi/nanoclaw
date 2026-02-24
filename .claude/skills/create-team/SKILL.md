---
name: create-team
description: Create a new team under a domain in the hierarchical topology. Adds a ReAct agent team with system prompt, tools, and LLM configuration. Use when user says "create team", "add team", "new team", or wants to add an agent team to a domain.
---

# Create Team

Create a new team under a domain supervisor in the hierarchical topology. A team is a ReAct agent (LLM + tool loop) that handles a specific type of task within its domain.

## What This Creates

```
  {domain_name}_supervisor
       |
       +---> [existing teams]
       |
       +---> NEW: {team_name}
                   agent <---> tools
                   (ReAct loop)
```

## Prerequisites

- `/topology hierarchical` must have been applied
- The target domain must exist (created with `/create-domain`). Verify:
  - `graphs/domains/{domain_name}/supervisor.py` exists
  - `graphs/domains/{domain_name}/teams/` directory exists
- If the domain does not exist, tell the user to run `/create-domain` first.

## Parameters

Ask the user for:

1. **Domain name** -- Which domain this team belongs to (must already exist)
2. **Team name** -- Snake_case identifier (e.g., `ticket_router`, `faq_responder`, `escalation`)
3. **Team description** -- What this team handles (used in the domain supervisor's router prompt)
4. **System prompt** -- The team's personality and instructions. If the user does not provide a detailed one, generate a reasonable default based on the team description.
5. **Tools** (optional) -- List of tools the team agent needs. Can be:
   - Built-in LangChain tools (e.g., `TavilySearchResults`, `WikipediaQueryRun`)
   - Custom tool functions (Claude will create stub files)
   - MCP server connections
6. **Model** (optional) -- LLM model override (default: project default from `config/settings.py`)

## Workflow

### Step 1: Validate

1. Check domain exists: `graphs/domains/{domain_name}/supervisor.py`
2. Check team name is unique within the domain: `graphs/domains/{domain_name}/teams/{team_name}/` should NOT exist
3. Check `library/patterns/react_agent.py` is available in the project (copied by `/topology hierarchical`)

### Step 2: Create team directory

```
{project_root}/
  graphs/
    domains/
      {domain_name}/
        teams/
          {team_name}/
            __init__.py
            graph.py
            tools.py        (if team has custom tools)
            prompts.py
```

### Step 3: Create team prompts

Create `graphs/domains/{domain_name}/teams/{team_name}/prompts.py`:

```python
"""Prompts for the {team_name} team."""

SYSTEM_PROMPT = """{system_prompt_from_user}"""

# Add any prompt templates the team needs
TOOL_INSTRUCTIONS = """When using tools, follow these guidelines:
- Always explain what you're doing before calling a tool
- If a tool fails, try an alternative approach
- Summarize tool results for the user"""
```

### Step 4: Create team tools (if applicable)

If the user specified tools, create `graphs/domains/{domain_name}/teams/{team_name}/tools.py`:

```python
"""Tools for the {team_name} team."""

from langchain_core.tools import tool

# Import any built-in tools the user requested
# from langchain_community.tools.tavily_search import TavilySearchResults

# Custom tools
@tool
def {tool_name}({params}) -> str:
    """{tool_description}"""
    # TODO: Implement
    return "Not implemented yet"


# Export all tools as a list
TOOLS = [
    # Add tools here
    # TavilySearchResults(),
    # {tool_name},
]
```

If the user requested specific built-in tools, import and add them. For custom tools, create stubs with TODO comments.

### Step 5: Create team graph

Create `graphs/domains/{domain_name}/teams/{team_name}/graph.py`:

```python
"""Graph for the {team_name} team -- ReAct agent with tool loop."""

from typing import Any, Dict, List

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, SystemMessage
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from config.settings import settings
from state import BaseState
from graphs.domains.{domain_name}.teams.{team_name}.prompts import SYSTEM_PROMPT

# Import tools (if any)
try:
    from graphs.domains.{domain_name}.teams.{team_name}.tools import TOOLS
except ImportError:
    TOOLS = []


async def agent(state: BaseState) -> Dict[str, Any]:
    """Run the {team_name} ReAct agent."""
    llm = ChatOpenAI(model=settings.default_model, temperature=0)

    if TOOLS:
        llm = llm.bind_tools(TOOLS)

    messages = state.get("messages", [])

    # Prepend system message
    system_msg = SystemMessage(content=SYSTEM_PROMPT)
    full_messages = [system_msg] + messages

    response = await llm.ainvoke(full_messages)

    return {"messages": [response]}


def should_continue(state: BaseState) -> str:
    """Check if agent wants to call tools or finish."""
    messages = state.get("messages", [])
    if not messages:
        return "end"
    last = messages[-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "end"


def _build_graph():
    """Build the ReAct agent graph for {team_name}."""
    workflow = StateGraph(BaseState)

    workflow.add_node("agent", agent)
    workflow.set_entry_point("agent")

    if TOOLS:
        workflow.add_node("tools", ToolNode(TOOLS))
        workflow.add_conditional_edges(
            "agent",
            should_continue,
            {"tools": "tools", "end": END},
        )
        workflow.add_edge("tools", "agent")
    else:
        workflow.add_edge("agent", END)

    return workflow.compile()


# Export compiled graph
{team_name}_graph = _build_graph()
```

### Step 6: Create team __init__.py

Create `graphs/domains/{domain_name}/teams/{team_name}/__init__.py`:

```python
from graphs.domains.{domain_name}.teams.{team_name}.graph import {team_name}_graph

__all__ = ["{team_name}_graph"]
```

### Step 7: Register team in domain supervisor

Edit `graphs/domains/{domain_name}/supervisor.py`:

1. Add the team to the `TEAMS` dict:
   ```python
   TEAMS: Dict[str, str] = {
       # ... existing teams ...
       "{team_name}": "{team_description}",
   }
   ```

2. The supervisor rebuilds its router using the TEAMS dict, so the new team will be included automatically.

However, since the supervisor graph is compiled at import time, you also need to make sure the team's subgraph is imported and added as a node. Edit the `_build_supervisor()` function to add:

```python
from graphs.domains.{domain_name}.teams.{team_name} import {team_name}_graph
```

And in the graph building section, add the team as a node:
```python
workflow.add_node("{team_name}", {team_name}_graph)
workflow.add_edge("{team_name}", END)
```

IMPORTANT: Read the current `supervisor.py`, understand its structure, and add the new team at the correct locations. The supervisor must:
1. Have the team in `TEAMS`
2. Import the team graph
3. Add it as a node in the workflow
4. Include it in the `route_map` for conditional edges

### Step 8: Update domain teams/__init__.py

Edit `graphs/domains/{domain_name}/teams/__init__.py` to export the new team:

```python
from graphs.domains.{domain_name}.teams.{team_name} import {team_name}_graph
# ... other team imports ...
```

### Step 9: Report results

```
Team "{team_name}" created under domain "{domain_name}".

Files created:
  graphs/domains/{domain_name}/teams/{team_name}/
    __init__.py
    graph.py                  -- ReAct agent with tool loop
    prompts.py                -- System prompt and instructions
    tools.py                  -- Team tools (if applicable)

Files modified:
  graphs/domains/{domain_name}/supervisor.py  -- Added team to TEAMS registry and graph

Flow: {domain_name}_supervisor -> {team_name} (ReAct: agent <-> tools) -> END

System prompt: {first_line_of_prompt}...
Tools: {tool_list_or_none}
Model: {model_or_default}
```

## Files Created

| File | Purpose |
|------|---------|
| `graphs/domains/{domain}/teams/{team}/__init__.py` | Package, exports team graph |
| `graphs/domains/{domain}/teams/{team}/graph.py` | ReAct agent graph |
| `graphs/domains/{domain}/teams/{team}/prompts.py` | System prompt |
| `graphs/domains/{domain}/teams/{team}/tools.py` | Tools (if applicable) |

## Files Modified

| File | Changes |
|------|---------|
| `graphs/domains/{domain}/supervisor.py` | Added team to TEAMS, imported graph, added node |
| `graphs/domains/{domain}/teams/__init__.py` | Added team export |

## Example Usage

```
User: /create-team
Claude: Which domain? (List existing domains)
User: customer_support
Claude: What's the team name?
User: ticket_router
Claude: What does this team do?
User: Routes incoming support tickets to the right category and priority level
Claude: What system prompt should it use? (Or I can generate one)
User: Generate one
Claude: Does this team need any tools?
User: It needs access to our ticket database -- create a stub for that
Claude: [Creates team with ReAct agent, generated system prompt, database tool stub]
        [Registers in customer_support supervisor]

        Team "ticket_router" created. Edit the system prompt in prompts.py
        and implement the tool stub in tools.py.
```

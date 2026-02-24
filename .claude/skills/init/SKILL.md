---
name: init
description: "Initialize a new AOD Engine LangGraph project from the base template. Triggers on \"init\", \"new project\", \"create project\", \"scaffold\", \"bootstrap\"."
---

# Initialize AOD Engine Project

Create a new LangGraph multi-agent project from the base template. This sets up the directory structure, installs dependencies, and initializes tracking state.

## Prerequisites

- The AOD Engine repository must be available at the path where this skill is installed.
- Python 3.11+ must be available on the system.
- Git must be installed.

## Parameters

Gather these from the user before proceeding. Use `AskUserQuestion` for each.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `project_name` | Yes | — | Name for the project (used in pyproject.toml and directory name). Must be a valid Python package name (lowercase, hyphens or underscores, no spaces). |
| `llm_provider` | Yes | `openai` | LLM provider: `openai`, `google`, or `anthropic`. |
| `output_directory` | Yes | `./{project_name}` | Where to create the project. Absolute or relative path. |

## Workflow

### 1. Validate Parameters

- Ensure `project_name` is a valid Python identifier-like string (lowercase, hyphens/underscores allowed, no spaces or special characters).
- Ensure `output_directory` does not already contain a LangGraph project (check for `graph.py` or `langgraph.json`). If it does, warn the user and ask for confirmation before overwriting.
- Normalize `llm_provider` to lowercase and validate it is one of: `openai`, `google`, `anthropic`.

### 2. Copy Base Template

Copy the entire contents of `templates/base/` to the output directory:

```
templates/base/
  ├── .env.example
  ├── .gitignore
  ├── Dockerfile
  ├── docker-compose.yml
  ├── config/
  │   ├── __init__.py
  │   └── settings.py
  ├── graph.py
  ├── langgraph.json
  ├── main.py
  ├── pyproject.toml
  └── state.py
```

Use `cp -r` to copy the directory tree. Ensure hidden files (`.env.example`, `.gitignore`) are included.

```bash
cp -r <aod_engine_root>/templates/base/. <output_directory>/
```

### 3. Update pyproject.toml

Edit `<output_directory>/pyproject.toml`:

- Replace `name = "my-agent-system"` with `name = "<project_name>"`.
- Replace `description = "Multi-agent LangGraph system created with AOD Engine"` with `description = "LangGraph agent system: <project_name>"`.

Based on the LLM provider, update the dependencies:
- **openai**: Keep `langchain-openai>=0.2.0` (already present). No changes needed.
- **google**: Replace `langchain-openai>=0.2.0` with `langchain-google-genai>=2.0.0`.
- **anthropic**: Replace `langchain-openai>=0.2.0` with `langchain-anthropic>=0.3.0`.

### 4. Update config/settings.py

Edit `<output_directory>/config/settings.py`:

- Set `app_name` default to the project name: `app_name: str = "<project_name>"`.
- Set `default_model` based on provider:
  - **openai**: `default_model: str = "gpt-4o-mini"`
  - **google**: `default_model: str = "gemini-2.0-flash"`
  - **anthropic**: `default_model: str = "claude-sonnet-4-20250514"`

### 5. Update .env.example

Edit `<output_directory>/.env.example`:

- Uncomment the appropriate API key line for the chosen provider.
- Update `APP_NAME` to the project name.
- Update `DEFAULT_MODEL` to match the model set in step 4.

### 6. Initialize .aod/state.yaml

Create `<output_directory>/.aod/state.yaml` with initial tracking state:

```yaml
version: "0.1.0"
project_name: "<project_name>"
llm_provider: "<llm_provider>"
created_at: "<ISO 8601 timestamp>"

graph:
  nodes: []
  edges: []
  entry_point: null
  subgraphs: []

state:
  fields:
    - name: messages
      type: "Annotated[List[BaseMessage], add_messages]"
      default: null
    - name: session_id
      type: str
      default: null
    - name: metadata
      type: "Dict[str, Any]"
      default: null

agents: []
tools: []
```

### 7. Initialize Git Repository

```bash
cd <output_directory> && git init && git add -A && git commit -m "Initial AOD Engine project: <project_name>"
```

### 8. Install Dependencies (if venv exists)

Check if a Python virtual environment exists:

```bash
test -d <output_directory>/.venv || test -d <output_directory>/venv
```

If a venv exists, install dependencies:

```bash
cd <output_directory> && pip install -e ".[dev]"
```

If no venv exists, tell the user:

> Project created. To install dependencies, create a virtual environment and run:
> ```bash
> cd <output_directory>
> python -m venv .venv
> source .venv/bin/activate
> pip install -e ".[dev]"
> ```

### 9. Create Empty Directories

Create placeholder directories for future skills to populate:

```bash
mkdir -p <output_directory>/nodes
mkdir -p <output_directory>/agents
mkdir -p <output_directory>/tools
mkdir -p <output_directory>/subgraphs
```

Add empty `__init__.py` files in each:

```bash
touch <output_directory>/nodes/__init__.py
touch <output_directory>/agents/__init__.py
touch <output_directory>/tools/__init__.py
touch <output_directory>/subgraphs/__init__.py
```

## File Changes

**Created:**
- `<output_directory>/` -- entire project directory tree from template
- `<output_directory>/.aod/state.yaml` -- project tracking state
- `<output_directory>/nodes/__init__.py`
- `<output_directory>/agents/__init__.py`
- `<output_directory>/tools/__init__.py`
- `<output_directory>/subgraphs/__init__.py`
- `<output_directory>/.git/` -- initialized git repository

**Modified (from template defaults):**
- `<output_directory>/pyproject.toml` -- project name and provider-specific dependency
- `<output_directory>/config/settings.py` -- app name and default model
- `<output_directory>/.env.example` -- uncommented provider key, updated defaults

## Example

User: "Create a new project called research-assistant using Anthropic"

Result:
- Directory `./research-assistant/` created with full template
- `pyproject.toml` has `name = "research-assistant"` and `langchain-anthropic` dependency
- `config/settings.py` has `default_model = "claude-sonnet-4-20250514"`
- `.aod/state.yaml` initialized with empty graph topology
- Git repo initialized with initial commit
- User informed to create venv and install dependencies

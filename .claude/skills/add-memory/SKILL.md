---
name: add-memory
description: "Add persistent memory (checkpointer) to the LangGraph graph. Supports PostgreSQL and SQLite backends. Enables conversation history persistence across sessions. Triggers on 'add memory', 'add checkpointer', 'persistent memory', 'conversation history', 'add persistence'."
---

# Add Persistent Memory (Checkpointer)

Adds a persistent checkpointer to the LangGraph graph so conversation state (messages, metadata) survives across application restarts. Supports PostgreSQL and SQLite backends.

## What This Adds

- LangGraph checkpointer configuration (PostgreSQL or SQLite)
- Modified graph compilation with the checkpointer attached
- Database connection configuration in settings
- Thread-based conversation management (each session_id maps to a thread)

## Prerequisites

- The project must have a compiled graph in `graph.py`
- For PostgreSQL: a running PostgreSQL instance
- For SQLite: nothing additional (file-based)
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Which database backend?**
   - **PostgreSQL** (recommended for production): requires `langgraph-checkpoint-postgres`
   - **SQLite** (simpler, good for development): requires `langgraph-checkpoint-sqlite`
2. **Database connection string?**
   - PostgreSQL: `postgresql://user:password@host:5432/dbname`
   - SQLite: file path (default: `checkpoints.db`)
3. **Should old threads be automatically cleaned up?** (default: no)
   - If yes: set a TTL for threads (e.g., 30 days)

## Workflow

### Step 1: Update settings

Add to `config/settings.py` in the `Settings` class:

**For PostgreSQL:**
```python
    # Memory / Checkpointer
    checkpointer_backend: str = "postgres"  # or "sqlite"
    postgres_connection_string: str = ""
```

**For SQLite:**
```python
    # Memory / Checkpointer
    checkpointer_backend: str = "sqlite"
    sqlite_checkpoint_path: str = "checkpoints.db"
```

**For flexible configuration (supports both):**
```python
    # Memory / Checkpointer
    checkpointer_backend: str = "sqlite"  # "postgres" or "sqlite"
    postgres_connection_string: str = ""
    sqlite_checkpoint_path: str = "checkpoints.db"
```

### Step 2: Create the checkpointer factory

Create `config/checkpointer.py`:

```python
"""Checkpointer factory — creates the appropriate LangGraph checkpointer."""

import logging

from config.settings import settings

logger = logging.getLogger(__name__)


def create_checkpointer():
    """Create a checkpointer based on the configured backend.

    Returns:
        A LangGraph-compatible checkpointer instance.
    """
    backend = settings.checkpointer_backend.lower()

    if backend == "postgres":
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        if not settings.postgres_connection_string:
            raise ValueError(
                "POSTGRES_CONNECTION_STRING is required when using postgres checkpointer"
            )

        checkpointer = AsyncPostgresSaver.from_conn_string(
            settings.postgres_connection_string
        )
        logger.info("Using PostgreSQL checkpointer")
        return checkpointer

    elif backend == "sqlite":
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        checkpointer = AsyncSqliteSaver.from_conn_string(
            settings.sqlite_checkpoint_path
        )
        logger.info(f"Using SQLite checkpointer: {settings.sqlite_checkpoint_path}")
        return checkpointer

    else:
        raise ValueError(f"Unknown checkpointer backend: {backend}")
```

### Step 3: Modify graph.py to use the checkpointer

Update `graph.py` to compile the graph with the checkpointer:

**Before:**
```python
graph = builder.compile()
```

**After:**
```python
from config.checkpointer import create_checkpointer

checkpointer = create_checkpointer()
graph = builder.compile(checkpointer=checkpointer)
```

**Important:** For async checkpointers (PostgreSQL), the checkpointer must be set up within an async context. If the graph module is imported at module level, use a lazy initialization pattern:

```python
from config.checkpointer import create_checkpointer

# Compile without checkpointer at import time
_graph = builder.compile()

# Lazy-initialized version with checkpointer
_graph_with_memory = None


async def get_graph():
    """Get the graph with checkpointer (lazy init)."""
    global _graph_with_memory
    if _graph_with_memory is None:
        checkpointer = create_checkpointer()
        _graph_with_memory = builder.compile(checkpointer=checkpointer)
    return _graph_with_memory


# For backward compatibility, export the basic graph
graph = _graph
```

### Step 4: Update graph invocations to use thread_id

When invoking the graph with a checkpointer, you must pass a `thread_id` in the config. Update all invocation points:

**Before:**
```python
result = await graph.ainvoke(
    {
        "messages": [{"role": "user", "content": user_input}],
        "session_id": session_id,
        "metadata": {},
    }
)
```

**After:**
```python
result = await graph.ainvoke(
    {
        "messages": [{"role": "user", "content": user_input}],
        "session_id": session_id,
        "metadata": {},
    },
    config={"configurable": {"thread_id": session_id}},
)
```

This applies to:
- `main.py` interactive loop
- Channel handlers (telegram, discord, whatsapp, etc.)
- API endpoints
- Scheduler task execution

### Step 5: Update .env.example

Append:

**For PostgreSQL:**
```
# Memory / Checkpointer
CHECKPOINTER_BACKEND=postgres
POSTGRES_CONNECTION_STRING=postgresql://user:password@localhost:5432/agent_db
```

**For SQLite:**
```
# Memory / Checkpointer
CHECKPOINTER_BACKEND=sqlite
SQLITE_CHECKPOINT_PATH=checkpoints.db
```

### Step 6: Update pyproject.toml

Add the appropriate dependency:

**For PostgreSQL:**
```
"langgraph-checkpoint-postgres>=2.0.0",
"psycopg[binary]>=3.1.0",
```

**For SQLite:**
```
"langgraph-checkpoint-sqlite>=2.0.0",
"aiosqlite>=0.20.0",
```

### Step 7: Database setup (PostgreSQL only)

For PostgreSQL, the checkpointer tables need to be created. The `AsyncPostgresSaver` has a `setup()` method:

```python
async def setup_checkpointer():
    """Create checkpointer tables (run once)."""
    from config.checkpointer import create_checkpointer

    checkpointer = create_checkpointer()
    await checkpointer.setup()
    print("Checkpointer tables created.")
```

Add this to `main.py` or as a separate setup script.

### Step 8: Install dependencies

```bash
pip install -e .
```

## Files Created

| File | Purpose |
|------|---------|
| `config/checkpointer.py` | Checkpointer factory based on backend setting |

## Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add checkpointer backend and connection settings |
| `graph.py` | Compile graph with checkpointer |
| `main.py` | Add thread_id to invocations, optional setup step |
| `.env.example` | Add checkpointer configuration |
| `pyproject.toml` | Add checkpointer dependency |
| Channel/API files | Add `config={"configurable": {"thread_id": ...}}` to all `ainvoke` calls |

## Example

User: "Add persistent memory to my agent"

1. Ask: "Which database backend would you like? PostgreSQL (recommended for production) or SQLite (simpler, good for dev)?"
2. If PostgreSQL, ask for the connection string
3. Create `config/checkpointer.py`
4. Update settings with the backend configuration
5. Modify `graph.py` to compile with the checkpointer
6. Update all graph invocation points to include `thread_id`
7. Add dependencies to `pyproject.toml`
8. Tell the user: "Conversations are now persistent. Each `session_id` maps to a thread in the database. Messages from the same session will include full conversation history."

## Verification

After setup, the user should:
1. Set the database connection in `.env`
2. Run `python main.py`
3. Send a message: "My name is Alice"
4. Restart the application
5. Send a message with the same session_id: "What is my name?"
6. The agent should remember "Alice" from the previous session

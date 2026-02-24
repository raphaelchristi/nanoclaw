---
name: add-api
description: "Add FastAPI REST endpoints for the LangGraph graph. Creates /api/v1/chat with both invoke and SSE streaming modes. Triggers on 'add api', 'add rest api', 'add http endpoint', 'fastapi', 'api server'."
---

# Add FastAPI REST API

Adds a FastAPI HTTP server with REST endpoints for invoking the LangGraph graph. Includes both synchronous invoke and Server-Sent Events (SSE) streaming endpoints.

## What This Adds

- An `api/server.py` module with the FastAPI application
- An `api/routers/chat.py` module with `/api/v1/chat` endpoints (invoke + SSE stream)
- An `api/models.py` module with request/response Pydantic models
- Uvicorn server startup in `main.py`
- CORS configuration for frontend integration
- Health check endpoint

## Prerequisites

- The project must have a compiled graph in `graph.py`
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Port number?** (default: 8000)
2. **Enable CORS?** (default: yes)
   - If yes, ask for allowed origins (default: `["*"]` for development, recommend restricting in production)
3. **Authentication?** (default: none)
   - None (open)
   - API key header
   - Bearer token (JWT)
4. **Should the API also serve a static frontend?** (default: no)

## Workflow

### Step 1: Create the API models

Create `api/__init__.py` if it does not exist.
Create `api/routers/__init__.py` if it does not exist.

Create `api/models.py`:

```python
"""Request and response models for the API."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """Request body for the chat endpoint."""

    message: str = Field(description="User message to send to the graph")
    session_id: Optional[str] = Field(default=None, description="Session ID for conversation continuity")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    stream: bool = Field(default=False, description="Whether to stream the response via SSE")


class ChatResponse(BaseModel):
    """Response body for the chat endpoint."""

    response: str = Field(description="Agent response text")
    session_id: str = Field(description="Session ID used")
    metadata: Dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"
    version: str = "0.1.0"
```

### Step 2: Create the chat router

Create `api/routers/chat.py`:

```python
"""Chat API endpoints — invoke and stream the LangGraph graph."""

import json
import logging
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from api.models import ChatRequest, ChatResponse
from graph import graph

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat_invoke(request: ChatRequest) -> ChatResponse:
    """Invoke the graph with a message and return the full response."""
    session_id = request.session_id or str(uuid.uuid4())

    try:
        result = await graph.ainvoke(
            {
                "messages": [{"role": "user", "content": request.message}],
                "session_id": session_id,
                "metadata": {**request.metadata, "channel": "api"},
            }
        )

        response_text = ""
        if result.get("messages"):
            last_message = result["messages"][-1]
            response_text = (
                last_message.content
                if hasattr(last_message, "content")
                else str(last_message)
            )

        return ChatResponse(
            response=response_text,
            session_id=session_id,
            metadata=result.get("metadata", {}),
        )

    except Exception as e:
        logger.exception("Error invoking graph")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest) -> EventSourceResponse:
    """Stream the graph response via Server-Sent Events."""
    session_id = request.session_id or str(uuid.uuid4())

    async def event_generator() -> AsyncIterator[dict]:
        try:
            async for event in graph.astream_events(
                {
                    "messages": [{"role": "user", "content": request.message}],
                    "session_id": session_id,
                    "metadata": {**request.metadata, "channel": "api"},
                },
                version="v2",
            ):
                kind = event.get("event")

                if kind == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        yield {"event": "token", "data": json.dumps({"content": content})}

                elif kind == "on_chain_end":
                    if event.get("name") == "LangGraph":
                        yield {
                            "event": "done",
                            "data": json.dumps({"session_id": session_id}),
                        }

        except Exception as e:
            logger.exception("Error streaming graph")
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())
```

### Step 3: Create the FastAPI server

Create `api/server.py`:

```python
"""FastAPI application — REST API for the LangGraph graph."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.models import HealthResponse
from api.routers.chat import router as chat_router
from config.settings import settings

app = FastAPI(
    title=settings.app_name,
    description="LangGraph Multi-Agent System API",
    version="0.1.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(chat_router)


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse()
```

### Step 4: Update settings

Add to `config/settings.py` in the `Settings` class:

```python
    # API Server
    api_host: str = "0.0.0.0"
    api_port: int = 8000
```

### Step 5: Update main.py

Replace or modify `main.py` to start the uvicorn server:

```python
import asyncio
import uvicorn

from config.settings import settings


async def main():
    """Run the LangGraph system with FastAPI server."""
    from api.server import app

    config = uvicorn.Config(
        app,
        host=settings.api_host,
        port=settings.api_port,
        log_level="info",
    )
    server = uvicorn.Server(config)

    print(f"API server starting on http://{settings.api_host}:{settings.api_port}")
    print(f"Docs available at http://{settings.api_host}:{settings.api_port}/docs")

    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
```

**If other async services are running** (e.g., Telegram bot, scheduler), run them concurrently:

```python
async def main():
    from api.server import app

    config = uvicorn.Config(app, host=settings.api_host, port=settings.api_port)
    server = uvicorn.Server(config)

    async with asyncio.TaskGroup() as tg:
        tg.create_task(server.serve())
        # tg.create_task(other_service())
```

### Step 6: Update .env.example

Append:

```
# API Server
API_HOST=0.0.0.0
API_PORT=8000
```

### Step 7: Update pyproject.toml

Add these to the `dependencies` list:

```
"fastapi>=0.110.0",
"uvicorn>=0.27.0",
"sse-starlette>=2.0.0",
```

### Step 8: Install dependencies

```bash
pip install -e .
```

## Files Created

| File | Purpose |
|------|---------|
| `api/__init__.py` | Package init |
| `api/server.py` | FastAPI app with CORS and health check |
| `api/models.py` | Request/response Pydantic models |
| `api/routers/__init__.py` | Routers package init |
| `api/routers/chat.py` | `/api/v1/chat` invoke and SSE streaming endpoints |

## Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add `api_host` and `api_port` fields |
| `main.py` | Add uvicorn server startup |
| `.env.example` | Add `API_HOST`, `API_PORT` |
| `pyproject.toml` | Add `fastapi`, `uvicorn`, `sse-starlette` dependencies |

## Example

User: "Add a REST API to my agent"

1. Ask about port, CORS, and authentication preferences
2. Create `api/` package with server, models, and chat router
3. Modify `main.py` to run uvicorn
4. Add dependencies
5. Tell the user: "Run `python main.py` and visit `http://localhost:8000/docs` for the interactive API documentation."

Usage with curl:

```bash
# Invoke (synchronous)
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you do?"}'

# Stream (SSE)
curl -X POST http://localhost:8000/api/v1/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "Tell me a story", "stream": true}'
```

## Verification

After setup, the user should:
1. Run `python main.py`
2. Open `http://localhost:8000/docs` in a browser to see the Swagger UI
3. Test the `/api/v1/chat` endpoint via the UI or curl
4. Test the `/api/v1/chat/stream` endpoint for SSE streaming
5. Verify the `/health` endpoint returns `{"status": "ok"}`

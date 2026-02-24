---
name: add-whatsapp
description: "Add WhatsApp channel via Evolution API. Creates webhook handler for receiving WhatsApp messages and sending responses through Evolution API. Triggers on 'add whatsapp', 'whatsapp channel', 'whatsapp integration', 'evolution api'."
---

# Add WhatsApp Channel via Evolution API

Adds WhatsApp messaging support using [Evolution API](https://doc.evolution-api.com/) as the WhatsApp provider. Messages arrive via webhook, get processed by the LangGraph graph, and responses are sent back via the Evolution API REST endpoints.

## What This Adds

- A `channels/whatsapp.py` module with Evolution API client for sending messages
- A `api/routers/webhook.py` webhook endpoint for receiving incoming WhatsApp messages
- FastAPI server setup (if not already present from add-api skill)
- Environment variable configuration for Evolution API connection
- Message deduplication and media handling stubs

## Prerequisites

- An Evolution API instance running and accessible (self-hosted or cloud)
- A WhatsApp number connected to the Evolution API instance
- The project must have a compiled graph in `graph.py`
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Evolution API instance URL?** (e.g., `https://evo.example.com`)
2. **Do you already have the add-api skill installed?** (check if `api/server.py` exists)
   - If yes: add the webhook route to the existing FastAPI app
   - If no: create a minimal FastAPI server for the webhook
3. **Instance name in Evolution API?** (default: `default`)
4. **Should the bot respond to all messages or only when mentioned?**
   - Respond to all private messages
   - In groups: respond to all vs. only when mentioned

## Workflow

### Step 1: Create the WhatsApp channel module

Create `channels/__init__.py` if it does not exist.

Create `channels/whatsapp.py`:

```python
"""WhatsApp channel via Evolution API — send and receive messages."""

import logging
from typing import Any, Dict, Optional

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


class EvolutionAPIClient:
    """Client for sending messages through Evolution API."""

    def __init__(self):
        self.base_url = settings.evolution_api_url.rstrip("/")
        self.api_key = settings.evolution_api_key
        self.instance = settings.evolution_instance_name
        self.headers = {
            "apikey": self.api_key,
            "Content-Type": "application/json",
        }

    async def send_text(self, to: str, text: str) -> Dict[str, Any]:
        """Send a text message via Evolution API."""
        url = f"{self.base_url}/message/sendText/{self.instance}"
        payload = {
            "number": to,
            "text": text,
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def send_media(self, to: str, media_url: str, caption: str = "") -> Dict[str, Any]:
        """Send a media message via Evolution API."""
        url = f"{self.base_url}/message/sendMedia/{self.instance}"
        payload = {
            "number": to,
            "mediatype": "image",
            "media": media_url,
            "caption": caption,
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            response.raise_for_status()
            return response.json()


async def process_webhook_message(payload: Dict[str, Any]) -> Optional[str]:
    """Process an incoming Evolution API webhook payload.

    Extracts the message, invokes the graph, and sends the response.

    Returns:
        The response text, or None if the message was ignored.
    """
    from graph import graph

    # Evolution API webhook payload structure
    event = payload.get("event")
    if event != "messages.upsert":
        return None

    data = payload.get("data", {})
    key = data.get("key", {})

    # Skip messages sent by the bot itself
    if key.get("fromMe", False):
        return None

    remote_jid = key.get("remoteJid", "")
    message_content = ""

    # Extract text from different message types
    msg = data.get("message", {})
    if "conversation" in msg:
        message_content = msg["conversation"]
    elif "extendedTextMessage" in msg:
        message_content = msg["extendedTextMessage"].get("text", "")
    else:
        logger.debug(f"Unsupported message type: {list(msg.keys())}")
        return None

    if not message_content:
        return None

    push_name = data.get("pushName", "User")
    session_id = f"whatsapp:{remote_jid}"

    logger.info(f"WhatsApp message from {push_name} ({remote_jid})")

    try:
        result = await graph.ainvoke(
            {
                "messages": [{"role": "user", "content": message_content}],
                "session_id": session_id,
                "metadata": {
                    "channel": "whatsapp",
                    "remote_jid": remote_jid,
                    "push_name": push_name,
                },
            }
        )

        if result.get("messages"):
            last_message = result["messages"][-1]
            response_text = last_message.content if hasattr(last_message, "content") else str(last_message)

            # Send response back via Evolution API
            client = EvolutionAPIClient()
            await client.send_text(remote_jid, response_text)
            return response_text

    except Exception:
        logger.exception("Error processing WhatsApp message")

    return None
```

### Step 2: Create the webhook router

Create `api/__init__.py` if it does not exist.
Create `api/routers/__init__.py` if it does not exist.

Create `api/routers/webhook.py`:

```python
"""Webhook endpoint for receiving Evolution API (WhatsApp) messages."""

import logging

from fastapi import APIRouter, Request, Response

from channels.whatsapp import process_webhook_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/webhook", tags=["webhook"])


@router.post("/whatsapp")
async def whatsapp_webhook(request: Request) -> Response:
    """Receive WhatsApp messages from Evolution API."""
    payload = await request.json()
    logger.debug(f"WhatsApp webhook received: {payload.get('event')}")

    await process_webhook_message(payload)

    return Response(status_code=200)
```

### Step 3: Create or update the FastAPI server

**If `api/server.py` already exists** (add-api skill was applied):
- Import and include the webhook router:
  ```python
  from api.routers.webhook import router as webhook_router
  app.include_router(webhook_router)
  ```

**If `api/server.py` does not exist**, create a minimal one:

```python
"""Minimal FastAPI server for WhatsApp webhook."""

from fastapi import FastAPI

from api.routers.webhook import router as webhook_router

app = FastAPI(title="Agent Webhook Server")
app.include_router(webhook_router)
```

### Step 4: Update settings

Add to `config/settings.py` in the `Settings` class:

```python
    # WhatsApp / Evolution API
    evolution_api_url: str = ""
    evolution_api_key: str = ""
    evolution_instance_name: str = "default"
```

### Step 5: Update main.py

Add uvicorn startup for the webhook server. If main.py already runs a FastAPI server (add-api skill), just ensure the webhook router is registered. Otherwise, add:

```python
import uvicorn

async def main():
    """Run the LangGraph system with WhatsApp webhook server."""
    from api.server import app

    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()
```

### Step 6: Update .env.example

Append:

```
# WhatsApp / Evolution API
EVOLUTION_API_URL=https://your-evolution-api-instance.com
EVOLUTION_API_KEY=your-api-key
EVOLUTION_INSTANCE_NAME=default
```

### Step 7: Update pyproject.toml

Add these to the `dependencies` list (if not already present):

```
"fastapi>=0.110.0",
"uvicorn>=0.27.0",
"httpx>=0.27.0",
```

### Step 8: Install dependencies

```bash
pip install -e .
```

## Files Created

| File | Purpose |
|------|---------|
| `channels/__init__.py` | Package init (if not existing) |
| `channels/whatsapp.py` | Evolution API client, webhook message processing |
| `api/__init__.py` | Package init (if not existing) |
| `api/routers/__init__.py` | Package init (if not existing) |
| `api/routers/webhook.py` | FastAPI webhook endpoint for incoming WhatsApp messages |
| `api/server.py` | Minimal FastAPI app (only if not already present) |

## Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add Evolution API settings fields |
| `main.py` | Add webhook server startup |
| `.env.example` | Add `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` |
| `pyproject.toml` | Add `fastapi`, `uvicorn`, `httpx` dependencies |
| `api/server.py` | Include webhook router (if file already exists) |

## Example

User: "Add WhatsApp integration using Evolution API"

1. Ask for the Evolution API URL and instance name
2. Check if `api/server.py` exists (from add-api skill)
3. Create `channels/whatsapp.py` with Evolution API client
4. Create `api/routers/webhook.py` with the webhook endpoint
5. Wire everything into `main.py` and settings
6. Tell the user: "Configure your Evolution API instance to send webhooks to `http://your-server:8000/api/v1/webhook/whatsapp`. Set the environment variables in `.env`, then run `python main.py`."

## Verification

After setup, the user should:
1. Set `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` in `.env`
2. Run `python main.py`
3. Configure the Evolution API instance webhook URL to point to the server
4. Send a WhatsApp message to the connected number
5. Verify the graph processes it and a response is sent back

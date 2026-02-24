---
name: add-chatwoot
description: "Add Chatwoot integration for customer support. Creates a Chatwoot API client and webhook handler that bridges Chatwoot conversations with the LangGraph graph. Triggers on 'add chatwoot', 'chatwoot integration', 'chatwoot channel', 'customer support'."
---

# Add Chatwoot Integration

Adds [Chatwoot](https://www.chatwoot.com/) integration so the LangGraph graph can act as an AI agent in customer support conversations. Incoming Chatwoot messages arrive via webhook, get processed by the graph, and responses are sent back via the Chatwoot API.

## What This Adds

- An `integrations/chatwoot.py` module with Chatwoot API client for sending messages and managing conversations
- A `api/routers/webhook.py` endpoint for receiving Chatwoot webhook events
- Support for message_created, conversation_created, and conversation_status_changed events
- Agent handoff detection (stops responding when a human agent joins)
- Environment variable configuration for Chatwoot connection

## Prerequisites

- A Chatwoot instance (self-hosted or cloud) with API access
- An agent bot or API inbox configured in Chatwoot
- The project must have a compiled graph in `graph.py`
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Chatwoot instance URL?** (e.g., `https://chatwoot.example.com`)
2. **Agent bot mode or API inbox mode?**
   - **Agent bot**: Chatwoot assigns conversations to the bot automatically. Best for auto-reply before human handoff.
   - **API inbox**: The graph is the primary responder on a dedicated inbox.
3. **Should the bot hand off to a human agent?**
   - If yes: when the graph cannot handle the request (e.g., low confidence, explicit escalation), it changes the conversation status to "open" for human pickup.
   - If no: the graph handles all messages.
4. **Account ID?** (numeric, found in Chatwoot admin settings)

## Workflow

### Step 1: Create the Chatwoot integration module

Create `integrations/__init__.py` if it does not exist.

Create `integrations/chatwoot.py`:

```python
"""Chatwoot integration — API client and message processing."""

import logging
from typing import Any, Dict, List, Optional

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


class ChatwootClient:
    """Client for the Chatwoot API."""

    def __init__(self):
        self.base_url = settings.chatwoot_api_url.rstrip("/")
        self.api_token = settings.chatwoot_api_token
        self.account_id = settings.chatwoot_account_id
        self.headers = {
            "api_access_token": self.api_token,
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api/v1/accounts/{self.account_id}{path}"

    async def send_message(
        self, conversation_id: int, content: str, message_type: str = "outgoing"
    ) -> Dict[str, Any]:
        """Send a message in a Chatwoot conversation."""
        url = self._url(f"/conversations/{conversation_id}/messages")
        payload = {"content": content, "message_type": message_type}
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def toggle_status(self, conversation_id: int, status: str) -> Dict[str, Any]:
        """Toggle conversation status (open, resolved, pending, snoozed)."""
        url = self._url(f"/conversations/{conversation_id}/toggle_status")
        payload = {"status": status}
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def get_conversation(self, conversation_id: int) -> Dict[str, Any]:
        """Get conversation details."""
        url = self._url(f"/conversations/{conversation_id}")
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def assign_agent(self, conversation_id: int, agent_id: int) -> Dict[str, Any]:
        """Assign a human agent to the conversation."""
        url = self._url(f"/conversations/{conversation_id}/assignments")
        payload = {"assignee_id": agent_id}
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            response.raise_for_status()
            return response.json()


async def process_chatwoot_webhook(payload: Dict[str, Any]) -> Optional[str]:
    """Process an incoming Chatwoot webhook event.

    Handles message_created events by invoking the graph and sending
    the response back to the Chatwoot conversation.

    Returns:
        The response text, or None if the event was ignored.
    """
    from graph import graph

    event = payload.get("event")

    if event != "message_created":
        logger.debug(f"Ignoring Chatwoot event: {event}")
        return None

    message_type = payload.get("message_type")
    # Only process incoming messages (from the customer)
    if message_type != "incoming":
        return None

    content = payload.get("content", "")
    if not content:
        return None

    conversation = payload.get("conversation", {})
    conversation_id = conversation.get("id")
    contact = payload.get("sender", {})

    if not conversation_id:
        return None

    session_id = f"chatwoot:{conversation_id}"

    logger.info(
        f"Chatwoot message in conversation {conversation_id} "
        f"from {contact.get('name', 'Unknown')}"
    )

    try:
        result = await graph.ainvoke(
            {
                "messages": [{"role": "user", "content": content}],
                "session_id": session_id,
                "metadata": {
                    "channel": "chatwoot",
                    "conversation_id": conversation_id,
                    "contact_id": contact.get("id"),
                    "contact_name": contact.get("name", ""),
                    "inbox_id": conversation.get("inbox_id"),
                },
            }
        )

        if result.get("messages"):
            last_message = result["messages"][-1]
            response_text = (
                last_message.content
                if hasattr(last_message, "content")
                else str(last_message)
            )

            client = ChatwootClient()
            await client.send_message(conversation_id, response_text)
            return response_text

    except Exception:
        logger.exception("Error processing Chatwoot message")

    return None
```

### Step 2: Create the webhook router

Create `api/__init__.py` and `api/routers/__init__.py` if they do not exist.

**If `api/routers/webhook.py` already exists** (e.g., from add-whatsapp skill), add the Chatwoot endpoint to it:

```python
@router.post("/chatwoot")
async def chatwoot_webhook(request: Request) -> Response:
    """Receive Chatwoot webhook events."""
    payload = await request.json()
    logger.debug(f"Chatwoot webhook received: {payload.get('event')}")
    await process_chatwoot_webhook(payload)
    return Response(status_code=200)
```

**If `api/routers/webhook.py` does not exist**, create it:

```python
"""Webhook endpoints for external service integrations."""

import logging

from fastapi import APIRouter, Request, Response

from integrations.chatwoot import process_chatwoot_webhook

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/webhook", tags=["webhook"])


@router.post("/chatwoot")
async def chatwoot_webhook(request: Request) -> Response:
    """Receive Chatwoot webhook events."""
    payload = await request.json()
    logger.debug(f"Chatwoot webhook received: {payload.get('event')}")
    await process_chatwoot_webhook(payload)
    return Response(status_code=200)
```

### Step 3: Create or update the FastAPI server

Follow the same pattern as add-whatsapp: if `api/server.py` exists, include the webhook router. If not, create a minimal one.

### Step 4: Update settings

Add to `config/settings.py` in the `Settings` class:

```python
    # Chatwoot
    chatwoot_api_url: str = ""
    chatwoot_api_token: str = ""
    chatwoot_account_id: int = 1
```

### Step 5: Update main.py

Ensure the FastAPI server is started (same pattern as add-whatsapp). If already running, no changes needed.

### Step 6: Update .env.example

Append:

```
# Chatwoot
CHATWOOT_API_URL=https://your-chatwoot-instance.com
CHATWOOT_API_TOKEN=your-agent-bot-access-token
CHATWOOT_ACCOUNT_ID=1
```

### Step 7: Update pyproject.toml

Add these to `dependencies` (if not already present):

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
| `integrations/__init__.py` | Package init (if not existing) |
| `integrations/chatwoot.py` | Chatwoot API client, webhook event processing |
| `api/__init__.py` | Package init (if not existing) |
| `api/routers/__init__.py` | Package init (if not existing) |
| `api/routers/webhook.py` | Webhook endpoint (created or updated) |
| `api/server.py` | Minimal FastAPI app (only if not already present) |

## Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add Chatwoot settings fields |
| `main.py` | Add webhook server startup (if not already present) |
| `.env.example` | Add `CHATWOOT_API_URL`, `CHATWOOT_API_TOKEN`, `CHATWOOT_ACCOUNT_ID` |
| `pyproject.toml` | Add `fastapi`, `uvicorn`, `httpx` dependencies |

## Example

User: "Add Chatwoot so my agent handles customer support"

1. Ask for Chatwoot instance URL and account ID
2. Ask about agent bot vs. API inbox mode
3. Create `integrations/chatwoot.py` with API client
4. Create or update webhook endpoint
5. Wire into `main.py` and settings
6. Tell the user:
   - "In Chatwoot, go to Settings > Integrations > Agent Bots and create a new bot"
   - "Set the webhook URL to `http://your-server:8000/api/v1/webhook/chatwoot`"
   - "Copy the API token to `.env` as `CHATWOOT_API_TOKEN`"
   - "Run `python main.py`"

## Verification

After setup, the user should:
1. Set Chatwoot environment variables in `.env`
2. Run `python main.py`
3. Configure the Chatwoot webhook URL
4. Start a conversation on a Chatwoot inbox
5. Verify the bot responds via the graph

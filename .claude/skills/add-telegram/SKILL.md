---
name: add-telegram
description: "Add Telegram bot channel to the LangGraph project. Creates a Telegram bot that receives messages and invokes the graph. Supports both webhook and polling modes. Triggers on 'add telegram', 'telegram bot', 'telegram channel'."
---

# Add Telegram Bot Channel

Adds a Telegram bot that receives messages and forwards them to the LangGraph graph for processing, then sends responses back to the user.

## What This Adds

- A `channels/telegram.py` module with a Telegram bot using `python-telegram-bot`
- Webhook or long-polling message handler that invokes the compiled graph
- Startup/shutdown lifecycle hooks in `main.py`
- Environment variable configuration for the bot token
- Optional webhook mode with FastAPI integration (if add-api skill is installed)

## Prerequisites

- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- The project must have a compiled graph in `graph.py` (any topology)
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Polling or Webhook mode?**
   - **Polling** (default): Simpler setup, bot polls Telegram servers. Good for development and single-instance deployments.
   - **Webhook**: Requires a public URL. Better for production. If `api/server.py` exists (add-api skill), register the webhook route there. Otherwise, create a minimal FastAPI app for the webhook.

2. **Should the bot respond to all messages or only when mentioned?**
   - All messages in private chats (always)
   - In groups: respond to all vs. only when mentioned with `/ask` or `@botname`

## Workflow

### Step 1: Create the channel module

Create `channels/__init__.py` if it does not exist (empty file).

Create `channels/telegram.py`:

```python
"""Telegram bot channel — receives messages and invokes the LangGraph graph."""

import logging
from typing import Optional

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from graph import graph
from config.settings import settings

logger = logging.getLogger(__name__)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle incoming Telegram messages by invoking the graph."""
    if not update.message or not update.message.text:
        return

    user_id = str(update.effective_user.id)
    chat_id = str(update.effective_chat.id)
    session_id = f"telegram:{chat_id}:{user_id}"

    logger.info(f"Telegram message from {user_id} in {chat_id}")

    try:
        result = await graph.ainvoke(
            {
                "messages": [{"role": "user", "content": update.message.text}],
                "session_id": session_id,
                "metadata": {
                    "channel": "telegram",
                    "user_id": user_id,
                    "chat_id": chat_id,
                    "username": update.effective_user.username or "",
                },
            }
        )

        if result.get("messages"):
            last_message = result["messages"][-1]
            response_text = last_message.content if hasattr(last_message, "content") else str(last_message)
            await update.message.reply_text(response_text)
    except Exception:
        logger.exception("Error processing Telegram message")
        await update.message.reply_text("Sorry, something went wrong processing your message.")


async def handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle the /start command."""
    await update.message.reply_text(
        f"Hello! I'm {settings.app_name}. Send me a message and I'll respond."
    )


def create_telegram_app() -> Application:
    """Create and configure the Telegram bot application."""
    if not settings.telegram_bot_token:
        raise ValueError("TELEGRAM_BOT_TOKEN is not set in environment")

    app = Application.builder().token(settings.telegram_bot_token).build()

    app.add_handler(CommandHandler("start", handle_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    return app
```

### Step 2: Update settings

Add to `config/settings.py` in the `Settings` class:

```python
    # Telegram
    telegram_bot_token: str = ""
    telegram_webhook_url: str = ""  # Only needed for webhook mode
```

### Step 3: Update main.py

Add the Telegram bot startup to the main function. For polling mode:

```python
import asyncio
from channels.telegram import create_telegram_app

async def main():
    """Run the LangGraph system with Telegram bot."""
    telegram_app = create_telegram_app()

    # Initialize the bot
    await telegram_app.initialize()
    await telegram_app.start()
    await telegram_app.updater.start_polling()

    print("Telegram bot is running. Press Ctrl+C to stop.")

    try:
        # Keep running until interrupted
        await asyncio.Event().wait()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        await telegram_app.updater.stop()
        await telegram_app.stop()
        await telegram_app.shutdown()
```

For webhook mode (when add-api is present), instead register the webhook in the FastAPI app lifespan.

### Step 4: Update .env.example

Append:

```
# Telegram Bot
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
# TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/v1/telegram/webhook
```

### Step 5: Update pyproject.toml

Add `"python-telegram-bot>=21.0"` to the `dependencies` list in `pyproject.toml`.

### Step 6: Install dependencies

```bash
pip install -e .
```

## Files Created

| File | Purpose |
|------|---------|
| `channels/__init__.py` | Package init (if not existing) |
| `channels/telegram.py` | Telegram bot handler, message processing, graph invocation |

## Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add `telegram_bot_token` and `telegram_webhook_url` fields |
| `main.py` | Add Telegram bot initialization and lifecycle management |
| `.env.example` | Add `TELEGRAM_BOT_TOKEN` variable |
| `pyproject.toml` | Add `python-telegram-bot>=21.0` dependency |

## Example

User: "Add a Telegram bot to my project"

1. Ask polling vs. webhook preference
2. Create `channels/telegram.py` with message handler that invokes the graph
3. Add settings fields for the bot token
4. Modify `main.py` to start the Telegram bot in the async event loop
5. Update `.env.example` and `pyproject.toml`
6. Tell the user: "Create a bot via @BotFather on Telegram, copy the token to your `.env` file as `TELEGRAM_BOT_TOKEN`, then run `python main.py`."

## Verification

After setup, the user should:
1. Set `TELEGRAM_BOT_TOKEN` in `.env`
2. Run `python main.py`
3. Open Telegram, find the bot, send `/start`
4. Send a message and verify the graph processes it and responds

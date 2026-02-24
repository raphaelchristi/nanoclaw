---
name: add-discord
description: "Add Discord bot channel to the LangGraph project. Creates a Discord bot that listens for messages and invokes the graph. Triggers on 'add discord', 'discord bot', 'discord channel', 'discord integration'."
---

# Add Discord Bot Channel

Adds a Discord bot that listens for messages in configured channels, processes them through the LangGraph graph, and sends responses back.

## What This Adds

- A `channels/discord.py` module with a Discord bot using `discord.py`
- Message handler that invokes the compiled graph
- Bot lifecycle management in `main.py`
- Environment variable configuration for the bot token
- Support for DMs and guild channel messages

## Prerequisites

- A Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- The bot must be invited to a server with the `MESSAGE_CONTENT` privileged intent enabled
- The project must have a compiled graph in `graph.py`
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Should the bot respond to all messages or only when mentioned?**
   - In DMs: always respond
   - In server channels: respond to all messages vs. only when mentioned (`@bot` or prefix command)
2. **Command prefix?** (default: `!` — e.g., `!ask what is the weather?`)
   - Or no prefix, just mention the bot
3. **Restrict to specific channels?** (default: respond in all channels the bot can see)
   - If yes, ask for channel IDs or names

## Workflow

### Step 1: Create the channel module

Create `channels/__init__.py` if it does not exist.

Create `channels/discord.py`:

```python
"""Discord bot channel — receives messages and invokes the LangGraph graph."""

import logging
from typing import Optional

import discord
from discord.ext import commands

from graph import graph
from config.settings import settings

logger = logging.getLogger(__name__)


class AgentBot(commands.Bot):
    """Discord bot that processes messages through the LangGraph graph."""

    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(command_prefix=settings.discord_command_prefix, intents=intents)

    async def on_ready(self):
        logger.info(f"Discord bot connected as {self.user} (ID: {self.user.id})")

    async def on_message(self, message: discord.Message):
        # Ignore messages from the bot itself
        if message.author == self.user:
            return

        # Process commands first
        await self.process_commands(message)

        # Determine if we should respond
        should_respond = False

        # Always respond in DMs
        if isinstance(message.channel, discord.DMChannel):
            should_respond = True
        # In guilds, respond when mentioned
        elif self.user.mentioned_in(message):
            should_respond = True

        if not should_respond:
            return

        # Clean the message content (remove bot mention)
        content = message.content
        if self.user:
            content = content.replace(f"<@{self.user.id}>", "").replace(f"<@!{self.user.id}>", "").strip()

        if not content:
            return

        session_id = f"discord:{message.channel.id}:{message.author.id}"

        logger.info(f"Discord message from {message.author} in {message.channel}")

        async with message.channel.typing():
            try:
                result = await graph.ainvoke(
                    {
                        "messages": [{"role": "user", "content": content}],
                        "session_id": session_id,
                        "metadata": {
                            "channel": "discord",
                            "user_id": str(message.author.id),
                            "channel_id": str(message.channel.id),
                            "guild_id": str(message.guild.id) if message.guild else "",
                            "username": str(message.author),
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
                    # Discord has a 2000 char limit per message
                    for i in range(0, len(response_text), 2000):
                        await message.reply(response_text[i : i + 2000])
            except Exception:
                logger.exception("Error processing Discord message")
                await message.reply("Sorry, something went wrong processing your message.")


def create_discord_bot() -> AgentBot:
    """Create and return the Discord bot instance."""
    if not settings.discord_bot_token:
        raise ValueError("DISCORD_BOT_TOKEN is not set in environment")
    return AgentBot()
```

### Step 2: Update settings

Add to `config/settings.py` in the `Settings` class:

```python
    # Discord
    discord_bot_token: str = ""
    discord_command_prefix: str = "!"
```

### Step 3: Update main.py

Modify `main.py` to run the Discord bot. The Discord bot has its own event loop, so it must be integrated carefully with any other async components:

```python
import asyncio
from channels.discord import create_discord_bot
from config.settings import settings

async def main():
    """Run the LangGraph system with Discord bot."""
    bot = create_discord_bot()

    print("Starting Discord bot...")
    try:
        await bot.start(settings.discord_bot_token)
    except KeyboardInterrupt:
        await bot.close()
```

**If other async services are already running** (e.g., FastAPI from add-api, Telegram polling), use `asyncio.gather()` or `asyncio.TaskGroup` to run them concurrently:

```python
async def main():
    """Run all services concurrently."""
    bot = create_discord_bot()

    async with asyncio.TaskGroup() as tg:
        tg.create_task(bot.start(settings.discord_bot_token))
        # tg.create_task(other_service())

    # Or for Python < 3.11:
    # await asyncio.gather(bot.start(settings.discord_bot_token), other_service())
```

### Step 4: Update .env.example

Append:

```
# Discord Bot
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_COMMAND_PREFIX=!
```

### Step 5: Update pyproject.toml

Add `"discord.py>=2.3.0"` to the `dependencies` list in `pyproject.toml`.

### Step 6: Install dependencies

```bash
pip install -e .
```

## Files Created

| File | Purpose |
|------|---------|
| `channels/__init__.py` | Package init (if not existing) |
| `channels/discord.py` | Discord bot class, message handler, graph invocation |

## Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add `discord_bot_token` and `discord_command_prefix` fields |
| `main.py` | Add Discord bot startup and lifecycle management |
| `.env.example` | Add `DISCORD_BOT_TOKEN` variable |
| `pyproject.toml` | Add `discord.py>=2.3.0` dependency |

## Example

User: "Add a Discord bot to my agent"

1. Ask about mention-only vs. all-messages behavior
2. Create `channels/discord.py` with bot class
3. Add settings fields for token and prefix
4. Modify `main.py` to start the bot
5. Update `.env.example` and `pyproject.toml`
6. Tell the user:
   - "Go to the Discord Developer Portal, create an application, and create a bot"
   - "Enable the MESSAGE_CONTENT privileged intent"
   - "Generate an invite link with `bot` scope and `Send Messages` + `Read Message History` permissions"
   - "Add the bot to your server"
   - "Copy the token to `.env` as `DISCORD_BOT_TOKEN`"
   - "Run `python main.py`"

## Verification

After setup, the user should:
1. Set `DISCORD_BOT_TOKEN` in `.env`
2. Run `python main.py`
3. See "Discord bot connected as ..." in the logs
4. Mention the bot in a Discord channel or send a DM
5. Verify the graph processes the message and the bot replies

"""Entry point for the LangGraph multi-agent system.

This file is the main entry point. Skills modify it to add
channels, API servers, schedulers, and other runtime components.
"""

import asyncio
import uuid

from graph import graph


async def main():
    """Run a simple interactive loop for testing."""
    session_id = str(uuid.uuid4())
    print("LangGraph Multi-Agent System")
    print("Type 'quit' to exit.\n")

    while True:
        user_input = input("You: ")
        if user_input.lower() in ("quit", "exit"):
            break

        result = await graph.ainvoke(
            {
                "messages": [{"role": "user", "content": user_input}],
                "session_id": session_id,
                "metadata": {},
            }
        )

        if result.get("messages"):
            last_message = result["messages"][-1]
            print(f"Agent: {last_message.content}\n")


if __name__ == "__main__":
    asyncio.run(main())

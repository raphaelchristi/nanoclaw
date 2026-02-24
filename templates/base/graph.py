"""Main graph definition — empty canvas ready for skills to add nodes and edges."""

from langgraph.graph import END, StateGraph

from state import BaseState

# Create the graph builder — skills will add nodes and edges
builder = StateGraph(BaseState)

# Placeholder entry point — replaced by skills when topology is applied
builder.set_entry_point("__end__")

# Compile the graph
graph = builder.compile()

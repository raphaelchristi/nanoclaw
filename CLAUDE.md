# AOD Engine

AOD Engine - AI-driven engine for creating, composing and evolving multi-agent LangGraph systems using composable skills. Fork of [NanoClaw](https://github.com/qwibitai/nanoclaw).

## What AOD Engine Is

AOD Engine is a **creator of topologies**, not a runtime. It uses Claude Code skills + a three-way merge engine to incrementally build multi-agent LangGraph systems. Think of it as an architect's toolkit for designing agent graphs.

**Core philosophy**: topology-agnostic, composable, incremental. No fixed architecture — the hierarchical pattern is just one preset among many.

## Architecture

```
AOD Engine
├── .claude/skills/          ← Composable skills (the core product)
│   ├── Primitives           ← /add-node, /add-edge, /add-agent, etc.
│   ├── Topology Presets     ← /topology hierarchical|pipeline|hub-spoke|...
│   ├── Domain               ← /create-domain, /create-team, /create-squad
│   ├── Integrations         ← /add-telegram, /add-whatsapp, /add-api, ...
│   └── Infrastructure       ← /add-sandbox, /add-scheduler, /add-memory, ...
├── skills-engine/           ← Three-way merge engine
├── templates/base/          ← Minimal LangGraph project template
├── library/                 ← Reusable components copied into projects
│   ├── routers/             ← LLM router, sticky router
│   ├── patterns/            ← ReAct, supervisor, coordinator, aggregator
│   ├── state/               ← RoutingState, IntentState, PipelineState
│   └── hooks/               ← Intent classifier
└── scripts/                 ← CLI utilities (apply-skill, uninstall, etc.)
```

## Skills — Two Levels

### Level 1: Graph Primitives (Low-Level)
Manipulate StateGraph directly:
- `/init` — Create minimal project from template
- `/add-node` — Add node to graph
- `/add-edge` — Connect nodes (fixed or conditional)
- `/add-subgraph` — Add subgraph as node
- `/add-state-field` — Add field to State
- `/add-entry-point` — Set graph entry point
- `/add-tool` — Add tool to an agent
- `/add-agent` — Full agent node (LLM + tools + ReAct)

### Level 2: Topology Presets (High-Level)
Compose primitives into complete architectures:
- `/topology hierarchical` — Root → Domain → Team → Agent (ceppem-mvp pattern)
- `/topology pipeline` — Sequential: A → B → C → D
- `/topology swarm` — Dynamic agent selection
- `/topology hub-spoke` — Coordinator ↔ Specialists
- `/topology map-reduce` — Fan-out → Workers → Aggregator
- `/topology network` — Free mesh, bidirectional edges
- `/topology custom` — Interactive graph design

### Domain Skills (hierarchical preset)
- `/create-domain` — Domain + supervisor
- `/create-team` — Team with ReAct graph
- `/create-squad` — Cross-domain composition

### Integration Skills
- `/add-telegram`, `/add-whatsapp`, `/add-discord`, `/add-chatwoot`, `/add-gmail`

### Infrastructure Skills
- `/add-api` — FastAPI endpoints
- `/add-sandbox` — Container sandboxing
- `/add-scheduler` — Cron/interval tasks
- `/add-hooks` — Pre-tool intent classification
- `/add-memory` — Persistent checkpointer
- `/add-observability` — LangSmith tracing

### Operational Skills
- `/customize` — Modify project behavior
- `/debug` — Troubleshoot issues
- `/update` — Pull upstream changes
- `/visualize` — Mermaid diagram of current graph

## How the Skills Engine Works

The engine uses **git-style three-way merge** to apply skills:

1. **Base snapshot**: `.aod/base/` stores the pristine state of tracked files
2. **Current state**: Working tree files (may have user modifications)
3. **Skill changes**: Files in the skill's `add/` and `modify/` directories

When applying a skill:
- New files from `add/` are copied to the project
- Modified files use `git merge-file` (current ← base → skill)
- Structured merges handle pyproject.toml deps, .env vars, docker-compose services
- State tracked in `.aod/state.yaml`

This means users can freely modify generated code, and new skills merge cleanly with existing changes.

## Key Files

| File | Purpose |
|------|---------|
| `skills-engine/apply.ts` | Core skill application with three-way merge |
| `skills-engine/merge.ts` | Git merge-file wrapper |
| `skills-engine/structured.ts` | pyproject.toml, requirements.txt, .env, docker-compose merge |
| `skills-engine/state.ts` | .aod/state.yaml management |
| `skills-engine/replay.ts` | Re-apply skills after update |
| `skills-engine/uninstall.ts` | Reverse a skill's changes |
| `templates/base/` | Minimal LangGraph project template |
| `library/` | Reusable component library |

## Development

```bash
npm install          # Install dependencies
npm test             # Run skills-engine tests
npm run typecheck    # TypeScript type checking
```

## Creating New Skills

A skill consists of:
1. `SKILL.md` — Instructions for Claude Code (what to do)
2. `manifest.yaml` — Deterministic declaration (files added/modified, deps)
3. `add/` — New files to create
4. `modify/` — Files to three-way merge
5. Optional: `tests/` — Verification tests

Skills are in `.claude/skills/{skill-name}/`.

## Library Components

The `library/` directory contains reusable Python components that skills copy into generated projects. They are NOT external dependencies — each skill selects what it needs and copies it.

- `routers/llm_router.py` — Generic LLM router (topology-agnostic)
- `routers/sticky_router.py` — Sticky routing wrapper
- `patterns/react_agent.py` — ReAct agent loop
- `patterns/supervisor.py` — Supervisor routing pattern
- `patterns/coordinator.py` — Hub-spoke coordinator
- `patterns/aggregator.py` — Map-reduce aggregation
- `patterns/pipeline_node.py` — Sequential pipeline stage
- `state/routing_state.py` — Routing state fields
- `state/intent_state.py` — Intent classification state
- `state/pipeline_state.py` — Pipeline tracking state
- `hooks/intent_classifier.py` — Multi-intent LLM classifier

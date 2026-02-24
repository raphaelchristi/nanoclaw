---
name: add-scheduler
description: "Add cron/interval task scheduling to the LangGraph project. Supports cron expressions, fixed intervals, and one-time tasks that invoke the graph on a schedule. Triggers on 'add scheduler', 'add cron', 'scheduled tasks', 'task scheduler', 'periodic tasks'."
---

# Add Task Scheduler

Adds a task scheduling system that can invoke the LangGraph graph on cron schedules, fixed intervals, or as one-time delayed tasks. Built on APScheduler for reliable scheduling with persistence.

## What This Adds

- A `scheduler/task_scheduler.py` module with the main scheduler class
- A `scheduler/models.py` module with task definition models
- APScheduler integration with async support
- Optional task persistence (SQLite job store)
- Lifecycle hooks in `main.py` for starting/stopping the scheduler
- Programmatic API for adding, removing, pausing, and listing tasks

## Prerequisites

- The project must have a compiled graph in `graph.py`
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **What kind of tasks do you need?**
   - **Cron** (e.g., "every day at 9am", "every Monday at 8:30am")
   - **Interval** (e.g., "every 5 minutes", "every 2 hours")
   - **One-time** (e.g., "in 30 minutes", "at 2025-03-15 14:00")
   - **All of the above** (most common)

2. **Should tasks persist across restarts?** (default: yes, using SQLite)
   - Yes: tasks survive application restarts
   - No: tasks are lost on restart (in-memory only)

3. **Initial tasks to configure?** (optional)
   - Ask for the schedule expression and the prompt/input for the graph

## Workflow

### Step 1: Create the scheduler package

Create `scheduler/__init__.py`:

```python
from scheduler.task_scheduler import TaskScheduler
from scheduler.models import TaskDefinition, TaskType

__all__ = ["TaskScheduler", "TaskDefinition", "TaskType"]
```

### Step 2: Create task models

Create `scheduler/models.py`:

```python
"""Task definition models for the scheduler."""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class TaskType(str, Enum):
    CRON = "cron"
    INTERVAL = "interval"
    ONE_TIME = "one_time"


class TaskDefinition(BaseModel):
    """Definition of a scheduled task."""

    id: str = Field(description="Unique task identifier")
    name: str = Field(description="Human-readable task name")
    task_type: TaskType
    enabled: bool = True

    # What to send to the graph
    prompt: str = Field(description="Message to send to the graph when the task fires")
    session_id: str = Field(default="scheduler", description="Session ID for graph invocation")
    metadata: Dict[str, Any] = Field(default_factory=dict)

    # Cron schedule (task_type=cron)
    cron_expression: Optional[str] = Field(
        default=None,
        description="Cron expression (minute hour day month day_of_week). E.g., '0 9 * * *' for daily at 9am",
    )

    # Interval schedule (task_type=interval)
    interval_seconds: Optional[int] = Field(
        default=None,
        description="Interval in seconds between executions",
    )

    # One-time schedule (task_type=one_time)
    run_at: Optional[datetime] = Field(
        default=None,
        description="UTC datetime for one-time execution",
    )

    # Callback for results (optional)
    result_callback: Optional[str] = Field(
        default=None,
        description="Dotted path to an async function to call with the graph result",
    )
```

### Step 3: Create the task scheduler

Create `scheduler/task_scheduler.py`:

```python
"""Task scheduler — runs graph invocations on cron, interval, or one-time schedules."""

import logging
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.jobstores.memory import MemoryJobStore

from scheduler.models import TaskDefinition, TaskType

logger = logging.getLogger(__name__)


class TaskScheduler:
    """Manages scheduled tasks that invoke the LangGraph graph."""

    def __init__(self, persistent: bool = True, db_path: str = "scheduler.db"):
        jobstores = {}
        if persistent:
            try:
                from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
                jobstores["default"] = SQLAlchemyJobStore(url=f"sqlite:///{db_path}")
            except ImportError:
                logger.warning("SQLAlchemy not installed, using in-memory job store")
                jobstores["default"] = MemoryJobStore()
        else:
            jobstores["default"] = MemoryJobStore()

        self.scheduler = AsyncIOScheduler(jobstores=jobstores)
        self._task_definitions: Dict[str, TaskDefinition] = {}

    def start(self) -> None:
        """Start the scheduler."""
        self.scheduler.start()
        logger.info("Task scheduler started")

    def stop(self) -> None:
        """Shut down the scheduler gracefully."""
        self.scheduler.shutdown(wait=True)
        logger.info("Task scheduler stopped")

    def add_task(self, task: TaskDefinition) -> None:
        """Add a scheduled task.

        Args:
            task: Task definition with schedule and graph input.
        """
        trigger = self._create_trigger(task)

        self.scheduler.add_job(
            self._execute_task,
            trigger=trigger,
            id=task.id,
            name=task.name,
            kwargs={"task": task},
            replace_existing=True,
        )
        self._task_definitions[task.id] = task
        logger.info(f"Task added: {task.name} ({task.task_type.value})")

    def remove_task(self, task_id: str) -> None:
        """Remove a scheduled task."""
        self.scheduler.remove_job(task_id)
        self._task_definitions.pop(task_id, None)
        logger.info(f"Task removed: {task_id}")

    def pause_task(self, task_id: str) -> None:
        """Pause a scheduled task."""
        self.scheduler.pause_job(task_id)
        logger.info(f"Task paused: {task_id}")

    def resume_task(self, task_id: str) -> None:
        """Resume a paused task."""
        self.scheduler.resume_job(task_id)
        logger.info(f"Task resumed: {task_id}")

    def list_tasks(self) -> List[Dict[str, Any]]:
        """List all scheduled tasks with their next run times."""
        jobs = self.scheduler.get_jobs()
        return [
            {
                "id": job.id,
                "name": job.name,
                "next_run": str(job.next_run_time) if job.next_run_time else "paused",
                "definition": self._task_definitions.get(job.id),
            }
            for job in jobs
        ]

    @staticmethod
    async def _execute_task(task: TaskDefinition) -> None:
        """Execute a task by invoking the graph."""
        from graph import graph

        logger.info(f"Executing scheduled task: {task.name}")

        try:
            result = await graph.ainvoke(
                {
                    "messages": [{"role": "user", "content": task.prompt}],
                    "session_id": f"scheduler:{task.session_id}",
                    "metadata": {
                        "channel": "scheduler",
                        "task_id": task.id,
                        "task_name": task.name,
                        **task.metadata,
                    },
                }
            )

            if result.get("messages"):
                last_message = result["messages"][-1]
                content = last_message.content if hasattr(last_message, "content") else str(last_message)
                logger.info(f"Task {task.name} completed. Response: {content[:200]}")

            # Call result callback if configured
            if task.result_callback:
                import importlib
                module_path, func_name = task.result_callback.rsplit(".", 1)
                module = importlib.import_module(module_path)
                callback = getattr(module, func_name)
                await callback(task, result)

        except Exception:
            logger.exception(f"Error executing task: {task.name}")

    @staticmethod
    def _create_trigger(task: TaskDefinition):
        """Create an APScheduler trigger from a task definition."""
        if task.task_type == TaskType.CRON:
            if not task.cron_expression:
                raise ValueError(f"Task {task.id}: cron_expression required for cron tasks")
            parts = task.cron_expression.split()
            if len(parts) == 5:
                return CronTrigger(
                    minute=parts[0],
                    hour=parts[1],
                    day=parts[2],
                    month=parts[3],
                    day_of_week=parts[4],
                )
            else:
                return CronTrigger.from_crontab(task.cron_expression)

        elif task.task_type == TaskType.INTERVAL:
            if not task.interval_seconds:
                raise ValueError(f"Task {task.id}: interval_seconds required for interval tasks")
            return IntervalTrigger(seconds=task.interval_seconds)

        elif task.task_type == TaskType.ONE_TIME:
            if not task.run_at:
                raise ValueError(f"Task {task.id}: run_at required for one_time tasks")
            return DateTrigger(run_date=task.run_at)

        else:
            raise ValueError(f"Unknown task type: {task.task_type}")
```

### Step 4: Update main.py

Add scheduler lifecycle to `main.py`:

```python
import asyncio
from scheduler import TaskScheduler, TaskDefinition, TaskType

async def main():
    """Run the LangGraph system with task scheduler."""
    # Initialize scheduler
    task_scheduler = TaskScheduler(persistent=True)
    task_scheduler.start()

    # Example: add a task programmatically
    # task_scheduler.add_task(TaskDefinition(
    #     id="daily-summary",
    #     name="Daily Summary",
    #     task_type=TaskType.CRON,
    #     cron_expression="0 9 * * *",  # Every day at 9am
    #     prompt="Generate a daily summary of pending items.",
    # ))

    print("Scheduler running. Press Ctrl+C to stop.")

    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        task_scheduler.stop()
```

**If other services are running**, integrate the scheduler start/stop into the existing lifecycle.

### Step 5: Update pyproject.toml

Add these to the `dependencies` list:

```
"APScheduler>=3.10.0",
"SQLAlchemy>=2.0.0",
```

### Step 6: Install dependencies

```bash
pip install -e .
```

## Files Created

| File | Purpose |
|------|---------|
| `scheduler/__init__.py` | Package exports |
| `scheduler/models.py` | TaskDefinition, TaskType Pydantic models |
| `scheduler/task_scheduler.py` | APScheduler wrapper, task execution, graph invocation |

## Files Modified

| File | Change |
|------|--------|
| `main.py` | Add scheduler initialization, start, and shutdown |
| `pyproject.toml` | Add `APScheduler` and `SQLAlchemy` dependencies |

## Example

User: "Add a scheduler so I can run tasks on a cron schedule"

1. Ask what kind of tasks they need
2. Ask about persistence
3. Create `scheduler/` package with models and scheduler
4. Modify `main.py` to start/stop the scheduler
5. Add dependencies
6. Show example of adding a task:
   ```python
   from scheduler import TaskScheduler, TaskDefinition, TaskType

   scheduler = TaskScheduler()
   scheduler.add_task(TaskDefinition(
       id="health-check",
       name="Health Check",
       task_type=TaskType.INTERVAL,
       interval_seconds=300,
       prompt="Check the status of all monitored services.",
   ))
   ```

## Verification

After setup, the user should:
1. Run `python main.py`
2. Add a test task with a short interval (e.g., 10 seconds)
3. Observe the task firing in the logs
4. Restart the application and verify persistent tasks are still scheduled
5. Test pause/resume functionality

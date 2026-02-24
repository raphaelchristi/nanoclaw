---
name: add-sandbox
description: "Add container sandboxing for safe tool execution. Tools that execute code or run commands are isolated in Docker containers with restricted filesystem access. Triggers on 'add sandbox', 'sandboxing', 'container isolation', 'safe execution', 'code sandbox'."
---

# Add Container Sandbox for Tool Execution

Adds Docker-based container sandboxing so that tools that execute arbitrary code or shell commands run in isolated containers rather than on the host. This prevents untrusted code from accessing the host filesystem, network, or secrets.

## What This Adds

- A `sandbox/container_runner.py` module that spawns Docker containers for tool execution
- A `sandbox/Dockerfile.agent` for building the sandbox container image
- A `sandbox/mount_security.py` module that validates and restricts volume mounts
- A `sandbox/config.py` for sandbox resource limits and allowed paths
- A wrapper pattern for tools that need sandboxed execution

## Prerequisites

- Docker installed and running on the host
- The project must have a compiled graph in `graph.py`
- Tools that should be sandboxed must be identified
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Which tools should run in the sandbox?**
   - Code execution tools (e.g., `run_python`, `run_bash`)
   - File manipulation tools
   - All tools (maximum isolation)
2. **Resource limits?**
   - Memory limit (default: 512MB)
   - CPU limit (default: 1 core)
   - Execution timeout (default: 60 seconds)
   - Network access (default: disabled)
3. **Should the sandbox have access to any host directories?** (default: none)
   - Read-only data directories
   - A writable workspace directory

## Workflow

### Step 1: Create the sandbox package

Create `sandbox/__init__.py`:

```python
from sandbox.container_runner import SandboxRunner
from sandbox.mount_security import validate_mount, MountPolicy

__all__ = ["SandboxRunner", "validate_mount", "MountPolicy"]
```

### Step 2: Create the container runner

Create `sandbox/container_runner.py`:

```python
"""Docker container runner for sandboxed tool execution."""

import asyncio
import json
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from sandbox.config import SandboxConfig
from sandbox.mount_security import MountPolicy, validate_mount

logger = logging.getLogger(__name__)


class SandboxResult:
    """Result from a sandboxed execution."""

    def __init__(self, stdout: str, stderr: str, exit_code: int, timed_out: bool = False):
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code
        self.timed_out = timed_out
        self.success = exit_code == 0 and not timed_out

    def __str__(self) -> str:
        if self.timed_out:
            return f"Execution timed out.\nStdout: {self.stdout}\nStderr: {self.stderr}"
        if not self.success:
            return f"Exit code {self.exit_code}.\nStdout: {self.stdout}\nStderr: {self.stderr}"
        return self.stdout


class SandboxRunner:
    """Runs code in isolated Docker containers."""

    def __init__(self, config: Optional[SandboxConfig] = None):
        self.config = config or SandboxConfig()
        self.mount_policy = MountPolicy(
            allowed_read_paths=self.config.allowed_read_paths,
            allowed_write_paths=self.config.allowed_write_paths,
        )

    async def run_code(
        self,
        code: str,
        language: str = "python",
        extra_mounts: Optional[List[Dict[str, str]]] = None,
    ) -> SandboxResult:
        """Execute code in a sandboxed container.

        Args:
            code: Source code to execute.
            language: Programming language (python, bash).
            extra_mounts: Additional volume mounts [{host_path, container_path, readonly}].

        Returns:
            SandboxResult with stdout, stderr, and exit code.
        """
        # Write code to a temp file
        suffix = ".py" if language == "python" else ".sh"
        with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False) as f:
            f.write(code)
            code_path = f.name

        # Build docker command
        cmd = self._build_docker_cmd(code_path, language, extra_mounts or [])

        logger.debug(f"Sandbox executing: {' '.join(cmd)}")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(),
                    timeout=self.config.timeout_seconds,
                )
                return SandboxResult(
                    stdout=stdout_bytes.decode("utf-8", errors="replace"),
                    stderr=stderr_bytes.decode("utf-8", errors="replace"),
                    exit_code=process.returncode or 0,
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                return SandboxResult(stdout="", stderr="Execution timed out", exit_code=-1, timed_out=True)

        finally:
            Path(code_path).unlink(missing_ok=True)

    async def run_command(self, command: str) -> SandboxResult:
        """Execute a shell command in a sandboxed container."""
        return await self.run_code(command, language="bash")

    def _build_docker_cmd(
        self, code_path: str, language: str, extra_mounts: List[Dict[str, str]]
    ) -> List[str]:
        """Build the docker run command."""
        cmd = [
            "docker", "run", "--rm",
            "--memory", self.config.memory_limit,
            "--cpus", str(self.config.cpu_limit),
            "--pids-limit", str(self.config.pids_limit),
            "--read-only",
            "--tmpfs", "/tmp:size=100M",
        ]

        # Network isolation
        if not self.config.network_enabled:
            cmd.extend(["--network", "none"])

        # Security options
        cmd.extend([
            "--security-opt", "no-new-privileges",
            "--cap-drop", "ALL",
        ])

        # Mount the code file
        cmd.extend(["-v", f"{code_path}:/workspace/code:ro"])

        # Extra mounts (validated)
        for mount in extra_mounts:
            host_path = mount["host_path"]
            container_path = mount["container_path"]
            readonly = mount.get("readonly", True)

            if not validate_mount(host_path, self.mount_policy):
                logger.warning(f"Mount rejected by policy: {host_path}")
                continue

            ro_flag = ":ro" if readonly else ""
            cmd.extend(["-v", f"{host_path}:{container_path}{ro_flag}"])

        # Image and execution command
        cmd.append(self.config.image_name)

        if language == "python":
            cmd.extend(["python", "/workspace/code"])
        elif language == "bash":
            cmd.extend(["bash", "/workspace/code"])

        return cmd
```

### Step 3: Create mount security

Create `sandbox/mount_security.py`:

```python
"""Mount security — validates and restricts volume mounts for sandboxed execution."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List


# Paths that must NEVER be mounted into a container
FORBIDDEN_PATHS = [
    "/etc/shadow",
    "/etc/passwd",
    "/etc/sudoers",
    "/root",
    "/proc",
    "/sys",
    "/dev",
    "/var/run/docker.sock",
    os.path.expanduser("~/.ssh"),
    os.path.expanduser("~/.aws"),
    os.path.expanduser("~/.gnupg"),
    os.path.expanduser("~/.config"),
]


@dataclass
class MountPolicy:
    """Policy for validating volume mounts."""

    allowed_read_paths: List[str] = field(default_factory=list)
    allowed_write_paths: List[str] = field(default_factory=list)
    forbidden_paths: List[str] = field(default_factory=lambda: FORBIDDEN_PATHS.copy())

    def is_allowed(self, host_path: str, writable: bool = False) -> bool:
        """Check if a host path is allowed to be mounted."""
        resolved = str(Path(host_path).resolve())

        # Check forbidden paths
        for forbidden in self.forbidden_paths:
            forbidden_resolved = str(Path(forbidden).resolve())
            if resolved == forbidden_resolved or resolved.startswith(forbidden_resolved + "/"):
                return False

        # Check allowed paths
        allowed = self.allowed_write_paths if writable else self.allowed_read_paths + self.allowed_write_paths
        if not allowed:
            return False

        for allowed_path in allowed:
            allowed_resolved = str(Path(allowed_path).resolve())
            if resolved == allowed_resolved or resolved.startswith(allowed_resolved + "/"):
                return True

        return False


def validate_mount(host_path: str, policy: MountPolicy, writable: bool = False) -> bool:
    """Validate a mount path against the security policy.

    Args:
        host_path: Path on the host to mount.
        policy: Mount policy with allowed/forbidden paths.
        writable: Whether the mount needs write access.

    Returns:
        True if the mount is allowed.
    """
    if not os.path.exists(host_path):
        return False

    return policy.is_allowed(host_path, writable)
```

### Step 4: Create sandbox configuration

Create `sandbox/config.py`:

```python
"""Sandbox configuration with resource limits."""

from dataclasses import dataclass, field
from typing import List

from config.settings import settings


@dataclass
class SandboxConfig:
    """Configuration for the sandbox container runner."""

    image_name: str = "aod-sandbox:latest"
    memory_limit: str = "512m"
    cpu_limit: float = 1.0
    timeout_seconds: int = 60
    pids_limit: int = 50
    network_enabled: bool = False
    allowed_read_paths: List[str] = field(default_factory=list)
    allowed_write_paths: List[str] = field(default_factory=list)
```

### Step 5: Create the Dockerfile

Create `sandbox/Dockerfile.agent`:

```dockerfile
FROM python:3.12-slim

# Create non-root user
RUN useradd --create-home --shell /bin/bash agent
USER agent
WORKDIR /workspace

# Pre-install common packages
RUN pip install --user --no-cache-dir \
    requests \
    httpx \
    pandas \
    numpy

ENV PATH="/home/agent/.local/bin:${PATH}"

# Default: run the mounted code file
CMD ["python", "/workspace/code"]
```

### Step 6: Create a tool wrapper

Show the user how to wrap existing tools for sandboxed execution. For example, if they have a `run_python` tool:

```python
"""Example: wrapping a tool for sandboxed execution."""

from langchain_core.tools import tool
from sandbox import SandboxRunner

sandbox = SandboxRunner()


@tool
async def run_python(code: str) -> str:
    """Execute Python code in an isolated sandbox container."""
    result = await sandbox.run_code(code, language="python")
    if result.success:
        return result.stdout
    else:
        return f"Error (exit code {result.exit_code}):\n{result.stderr}"
```

### Step 7: Build the sandbox image

```bash
docker build -t aod-sandbox:latest -f sandbox/Dockerfile.agent sandbox/
```

## Files Created

| File | Purpose |
|------|---------|
| `sandbox/__init__.py` | Package exports |
| `sandbox/container_runner.py` | Docker container spawning, execution, result capture |
| `sandbox/Dockerfile.agent` | Container image for sandboxed execution |
| `sandbox/mount_security.py` | Mount path validation and security policy |
| `sandbox/config.py` | Resource limits and sandbox configuration |

## Files Modified

| File | Change |
|------|--------|
| Tool files | Wrap tools that need sandboxing with `SandboxRunner` |

## Example

User: "Add sandboxing so code execution tools run in containers"

1. Ask which tools should be sandboxed
2. Ask about resource limits
3. Create the `sandbox/` package with container runner, mount security, and config
4. Create `sandbox/Dockerfile.agent`
5. Show how to wrap existing tools with `SandboxRunner`
6. Tell the user: "Build the sandbox image with `docker build -t aod-sandbox:latest -f sandbox/Dockerfile.agent sandbox/`, then wrap your code execution tools with `SandboxRunner`."

## Verification

After setup, the user should:
1. Build the sandbox image: `docker build -t aod-sandbox:latest -f sandbox/Dockerfile.agent sandbox/`
2. Test directly: `python -c "import asyncio; from sandbox import SandboxRunner; r = SandboxRunner(); print(asyncio.run(r.run_code('print(42)')))"`
3. Verify network isolation: code in the sandbox should not be able to reach the internet (when `network_enabled=False`)
4. Verify resource limits: code that tries to allocate excessive memory should be killed

"""Pipeline state extension for sequential processing topologies."""

from typing import Any, Dict, List, Optional

from typing_extensions import TypedDict


class PipelineState(TypedDict, total=False):
    """State fields for pipeline topologies.

    Tracks which stage of the pipeline is active and accumulates results.
    """

    current_stage: str
    stage_index: int
    pipeline_data: Dict[str, Any]
    stage_results: List[Dict[str, Any]]
    pipeline_complete: bool

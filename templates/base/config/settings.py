"""Application settings via pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuration loaded from environment variables.

    Skills extend this class to add their own settings.
    """

    # LLM Configuration
    openai_api_key: str = ""
    google_api_key: str = ""
    anthropic_api_key: str = ""
    default_model: str = "gpt-4o-mini"

    # Application
    app_name: str = "agent-system"
    debug: bool = False

    # LangSmith (optional)
    langchain_tracing_v2: bool = False
    langchain_api_key: str = ""
    langchain_project: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

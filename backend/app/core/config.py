from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "sysDock"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Security — no defaults; must be supplied via environment / .env
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "strict"
    ENABLE_API_DOCS: bool = False

    # Database — no defaults for credentials
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str

    # Redis
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    # Docker
    DOCKER_HOST: Optional[str] = None  # None uses default socket
    ENABLE_CONTAINER_SHELL: bool = True
    CONTAINER_SHELL_IDLE_TIMEOUT_SECONDS: int = 60 * 30
    CONTAINER_SHELL_MAX_COLS: int = 240
    CONTAINER_SHELL_MAX_ROWS: int = 80

    # CORS
    BACKEND_CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173", "http://localhost"]

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def REDIS_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

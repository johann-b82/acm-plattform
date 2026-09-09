from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Alle Werte kommen aus der gemeinsamen .env (Compose env_file)."""

    model_config = SettingsConfigDict(extra="ignore")

    # Supabase / GoTrue
    JWT_SECRET: str
    API_EXTERNAL_URL: str  # Issuer der GoTrue-JWTs
    JWT_AUDIENCE: str = "authenticated"

    # Postgres (Superuser für Alembic; App-Zugriff folgt mit eigener Rolle in Phase 4)
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "postgres"
    POSTGRES_PASSWORD: str

    COMPUTE_LOG_LEVEL: str = "warning"

    @property
    def sync_database_url(self) -> str:
        return (
            f"postgresql+psycopg://postgres:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def async_database_url(self) -> str:
        return (
            f"postgresql+asyncpg://postgres:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


settings = Settings()

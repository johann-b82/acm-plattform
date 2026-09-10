from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Alle Werte kommen aus der gemeinsamen .env (Compose env_file)."""

    model_config = SettingsConfigDict(extra="ignore")

    # Supabase / GoTrue
    JWT_SECRET: str
    API_EXTERNAL_URL: str  # Issuer der GoTrue-JWTs
    JWT_AUDIENCE: str = "authenticated"
    # Nur fuer die Admin-API von GoTrue (Personen anlegen). Bleibt serverseitig;
    # der Guard scripts/ci/check_service_role.sh haelt ihn aus dem Web-Bundle.
    SERVICE_ROLE_KEY: str
    GOTRUE_URL: str = "http://auth:9999"

    # Postgres (Superuser für Alembic; App-Zugriff folgt mit eigener Rolle in Phase 4)
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "postgres"
    POSTGRES_PASSWORD: str

    # Personio. Leer heisst: der Abgleich ist nicht eingerichtet und die Route
    # antwortet mit 503 statt zu scheitern.
    PERSONIO_CLIENT_ID: str = ""
    PERSONIO_CLIENT_SECRET: str = ""
    # Gemeinsames Geheimnis fuer den naechtlichen Anstoss aus pg_cron. Leer
    # heisst: nur angemeldete HR-Admins duerfen den Abgleich ausloesen.
    HR_SYNC_TOKEN: str = ""

    COMPUTE_LOG_LEVEL: str = "warning"
    # Größte angenommene Upload-Datei. Wird beim Lesen geprüft, nicht danach.
    MAX_UPLOAD_BYTES: int = 60 * 1024 * 1024

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

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
    # Storage-API im selben Netz. compute legt dort die erzeugten ATR-Dateien
    # ab — mit dem Service-Schlüssel, weil ein Hintergrundlauf (pg_cron) kein
    # Nutzertoken hat und die Regeln auf `storage.objects` einen eigenen Ordner
    # je Person verlangen.
    STORAGE_URL: str = "http://storage:5000"

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

    # ATR-Eingangsordner auf dem Dateiserver. Das Passwort steht hier und
    # nicht in der Datenbank: sonst braeuchte es zusaetzlich einen Schluessel
    # zum Entschluesseln, und der Geheimtext laege in jedem Abzug.
    ATR_SMB_PASSWORT: str = ""
    # Befund 16: welche Rechner der Dienst ueberhaupt ansprechen darf.
    # Kommagetrennt, je Eintrag ein Rechnername oder ein Netz in
    # CIDR-Schreibweise. Leer heisst: kein Ziel freigegeben, der Scan bleibt zu.
    ATR_SMB_ERLAUBT: str = ""
    # Gemeinsames Geheimnis fuer den Anstoss aus pg_cron, wie beim
    # Personio-Abgleich.
    ATR_SCAN_TOKEN: str = ""

    # Sensoren (SNMP). Der Schlüssel verschlüsselt die Community je Gerät;
    # ohne ihn lässt sich kein Sensor anlegen. Erzeugen mit:
    #   python -c "from cryptography.fernet import Fernet; \
    #              print(Fernet.generate_key().decode())"
    SENSOR_SCHLUESSEL: str = ""
    # Befund 16, zweiter Fall: welche Geräte der Dienst ansprechen darf.
    SNMP_ERLAUBT: str = ""
    # Gemeinsames Geheimnis für den Anstoss aus pg_cron.
    SENSOR_TOKEN: str = ""

    # Zeugnisse: die KI-Textbildung. Ohne Schlüssel bleibt sie inaktiv — der
    # Baukasten schreibt dann den Text, vollständig und ohne Netz.
    ANTHROPIC_API_KEY: str = ""
    ZEUGNIS_MODELL: str = "claude-opus-5"

    # Anzeigen für die Bildschirme (Befund 4). Unterschreibt die Token, mit
    # denen eine Tafel ohne Anmeldung an ihre Kachel kommt. Leer heisst: es
    # lassen sich keine Token erzeugen und keine prüfen — die Anzeigen sind
    # aus. Erzeugen mit: python -c "import secrets; print(secrets.token_urlsafe(32))"
    EMBED_SECRET: str = ""

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

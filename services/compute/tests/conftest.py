import os

# Werte für Tests ohne Stack; im Compose-Testlauf kommen sie aus der Umgebung.
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters!!")
os.environ.setdefault("API_EXTERNAL_URL", "http://localhost/supabase/auth/v1")
os.environ.setdefault("POSTGRES_PASSWORD", "unused")
os.environ.setdefault("POSTGRES_DB", "acm_test")
os.environ.setdefault("POSTGRES_HOST", "db")

# ---------------------------------------------------------------------------
# Riegel: Tests löschen ganze Tabellen. Nie gegen eine Nicht-Test-Datenbank.
# Im Altprojekt gingen so zweimal Produktivdaten verloren.
# ---------------------------------------------------------------------------
_ziel = os.environ["POSTGRES_DB"]
if "test" not in _ziel.lower():
    import pytest

    pytest.exit(
        f"ABBRUCH: POSTGRES_DB={_ziel!r} sieht nicht nach einer Test-Datenbank aus.",
        returncode=3,
    )

import pytest  # noqa: E402

from tests._auth import mint  # noqa: E402


@pytest.fixture(name="mint")
def mint_fixture():
    """Erzeugt Tokens; Overrides ändern einzelne Claims."""

    def _mint(**overrides):
        apps = overrides.pop("apps", {"sales": "viewer"})
        return mint(apps, **overrides)

    return _mint


@pytest.fixture(scope="session")
def datenbank_da() -> bool:
    """Einmal je Testlauf prüfen. Ohne Datenbank werden die DB-Tests
    übersprungen; ein Fehler bei erreichbarer Datenbank bleibt ein Fehler."""
    import asyncio

    import sqlalchemy as sa

    from app.db import SessionLocal

    async def _check() -> bool:
        try:
            async with SessionLocal() as session:
                await session.execute(sa.text("select 1"))
            return True
        except Exception:
            return False

    return asyncio.run(_check())

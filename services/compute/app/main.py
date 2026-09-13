import logging
import sys

from fastapi import Depends, FastAPI, Response
from sqlalchemy import text

from app.auth import Claims, get_claims
from app.config import settings
from app.db import engine
from app.routers.atr import geplant as atr_geplant
from app.routers.atr import router as atr_router
from app.routers.atr import verwaltung as atr_verwaltung
from app.routers.dokumente import router as dokumente_router
from app.routers.einarbeitung import router as einarbeitung_router
from app.routers.einstellungen import router as einstellungen_router
from app.routers.embed import router as embed_router
from app.routers.hr import nachweise_router
from app.routers.hr import router as hr_router
from app.routers.kompetenzen import router as kompetenzen_router
from app.routers.onboarding import router as onboarding_router
from app.routers.schulungen import router as schulungen_router
from app.routers.sensoren import geplant as sensoren_geplant
from app.routers.sensoren import router as sensoren_router
from app.routers.uploads import router as uploads_router
from app.routers.wartung import router as wartung_router
from app.routers.verwaltung import router as verwaltung_router
from app.routers.zeugnisse import router as zeugnisse_router

# Ein echter Handler (docs/logging.md Regel 4): WARNING nach stdout, sonst Stille.
logging.basicConfig(
    stream=sys.stdout,
    level=settings.COMPUTE_LOG_LEVEL.upper(),
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)

app = FastAPI(title="ACM compute", docs_url=None, redoc_url=None)
app.include_router(uploads_router)
app.include_router(atr_router)
app.include_router(atr_geplant)
app.include_router(atr_verwaltung)
app.include_router(hr_router)
app.include_router(nachweise_router)
app.include_router(dokumente_router)
app.include_router(einstellungen_router)
app.include_router(einarbeitung_router)
app.include_router(embed_router)
app.include_router(kompetenzen_router)
app.include_router(onboarding_router)
app.include_router(schulungen_router)
app.include_router(sensoren_router)
app.include_router(sensoren_geplant)
app.include_router(wartung_router)
app.include_router(verwaltung_router)
app.include_router(zeugnisse_router)


@app.get("/api/health")
async def health(response: Response) -> dict[str, str]:
    """Nacktes 503 bei DB-Ausfall — keine Exception-Texte nach außen."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("select 1"))
    except Exception:
        logging.getLogger(__name__).warning("health: database unreachable")
        response.status_code = 503
        return {"status": "unavailable"}
    return {"status": "ok"}


@app.get("/api/me")
async def me(claims: Claims = Depends(get_claims)) -> dict:
    """Zeigt, was compute aus dem Token liest — Prüfpunkt für Web und RLS."""
    return {"sub": claims.sub, "email": claims.email, "apps": claims.apps}

import logging
import sys

from fastapi import Depends, FastAPI, Response
from sqlalchemy import text

from app.auth import Claims, get_claims
from app.config import settings
from app.db import engine
from app.routers.atr import router as atr_router
from app.routers.hr import router as hr_router
from app.routers.uploads import router as uploads_router
from app.routers.verwaltung import router as verwaltung_router

# Ein echter Handler (docs/logging.md Regel 4): WARNING nach stdout, sonst Stille.
logging.basicConfig(
    stream=sys.stdout,
    level=settings.COMPUTE_LOG_LEVEL.upper(),
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)

app = FastAPI(title="ACM compute", docs_url=None, redoc_url=None)
app.include_router(uploads_router)
app.include_router(atr_router)
app.include_router(hr_router)
app.include_router(verwaltung_router)


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

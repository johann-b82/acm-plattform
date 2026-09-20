"""Sensoren gegen eine echte Datenbank.

Im Blick stehen zwei Grenzen: die Community verlässt die Datenbank nicht, und
geschrieben wird nur über `compute` — nicht über PostgREST.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"sensors":"viewer"}}' % USER_ID
VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.sensoren"))
                await s.execute(
                    sa.text(
                        "update public.sensor_einstellungen set abfrage_sekunden = 3600,"
                        " letzter_anstoss = null, temperatur_min = 16, temperatur_max = 30,"
                        " feuchte_min = 30, feuchte_max = 70"
                    )
                )

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.sensoren"
                    " (name, rechner, community, temperatur_oid)"
                    " values ('Serverraum', 'sensor.acm.local', '\\x00'::bytea,"
                    " '1.3.6.1.4.1.1.1')"
                )
            )
    yield
    await leeren()


async def als(claims: str, sql: str, **params):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


class TestRechte:
    @pytest.mark.asyncio
    async def test_wer_sensoren_hat_sieht_sie(self, db):
        zeilen = await als(LESER, "select name, rechner from public.sensoren")
        assert [z["name"] for z in zeilen] == ["Serverraum"]

    @pytest.mark.asyncio
    async def test_ohne_recht_bleibt_die_liste_leer(self, db):
        assert await als(FREMD, "select name from public.sensoren") == []

    @pytest.mark.asyncio
    async def test_die_community_gibt_die_datenbank_nicht_heraus(self, db):
        """Nicht die Policy hält sie zurück, sondern das Spaltenrecht — auch
        die Plattform-Verwaltung bekommt sie über PostgREST nicht."""
        with pytest.raises(Exception, match="permission denied|keine Berechtigung"):
            await als(VERWALTUNG, "select community from public.sensoren")

    @pytest.mark.asyncio
    async def test_geschrieben_wird_nur_ueber_compute(self, db):
        """Kein `insert`-Recht für `authenticated`: jede Änderung kann die
        Community tragen, und die zu verschlüsseln braucht den Schlüssel."""
        with pytest.raises(Exception, match="permission denied|keine Berechtigung"):
            await als(
                VERWALTUNG,
                "insert into public.sensoren (name, rechner, community, temperatur_oid)"
                " values ('Neu', 'x', '\\x00'::bytea, '1.1')",
            )

    @pytest.mark.asyncio
    async def test_der_stand_haelt_sich_an_dieselbe_grenze(self, db):
        assert await als(FREMD, "select * from public.sensor_stand") == []
        assert len(await als(LESER, "select * from public.sensor_stand")) == 1


class TestZeitreihe:
    @pytest.mark.asyncio
    async def test_dieselbe_sekunde_zaehlt_einmal(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                sensor_id = (
                    await s.execute(sa.text("select id from public.sensoren limit 1"))
                ).scalar()
                await s.execute(
                    sa.text(
                        "insert into public.sensor_messungen"
                        " (sensor_id, gemessen_am, temperatur)"
                        " values (:s, '2026-09-10 12:00:00+00', 21.5)"
                    ),
                    {"s": sensor_id},
                )
                with pytest.raises(Exception, match="duplicate|eindeutig"):
                    await s.execute(
                        sa.text(
                            "insert into public.sensor_messungen"
                            " (sensor_id, gemessen_am, temperatur)"
                            " values (:s, '2026-09-10 12:00:00+00', 99.9)"
                        ),
                        {"s": sensor_id},
                    )

    @pytest.mark.asyncio
    async def test_ein_geloeschter_sensor_nimmt_seine_zeitreihe_mit(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                sensor_id = (
                    await s.execute(sa.text("select id from public.sensoren limit 1"))
                ).scalar()
                await s.execute(
                    sa.text(
                        "insert into public.sensor_messungen"
                        " (sensor_id, gemessen_am, temperatur)"
                        " values (:s, now(), 21.5)"
                    ),
                    {"s": sensor_id},
                )
                await s.execute(sa.text("delete from public.sensoren where id = :s"),
                                {"s": sensor_id})
                uebrig = (
                    await s.execute(sa.text("select count(*) from public.sensor_messungen"))
                ).scalar()
        assert uebrig == 0


async def sql(text: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(text), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def sensor_id() -> str:
    return (await sql("select id from public.sensoren limit 1"))[0]["id"]


class TestEinstellungen:
    """SET-10/SET-11: ein Takt und vier Grenzen — für alle Geräte."""

    @pytest.mark.asyncio
    async def test_die_vorgaben_sind_die_der_referenz(self, db):
        zeilen = await als(
            LESER,
            "select abfrage_sekunden, temperatur_min, temperatur_max, feuchte_min, feuchte_max"
            " from public.sensor_einstellungen",
        )
        assert zeilen == [
            {"abfrage_sekunden": 3600, "temperatur_min": 16, "temperatur_max": 30,
             "feuchte_min": 30, "feuchte_max": 70}
        ]

    @pytest.mark.asyncio
    async def test_ohne_recht_sieht_man_sie_nicht(self, db):
        assert await als(FREMD, "select * from public.sensor_einstellungen") == []

    @pytest.mark.asyncio
    async def test_ein_leser_aendert_nichts(self, db):
        """Eine abgewiesene Änderung ist `UPDATE 0`, kein Fehler."""
        assert await als(
            LESER,
            "update public.sensor_einstellungen set abfrage_sekunden = 60 returning id",
        ) == []

    @pytest.mark.asyncio
    async def test_die_verwaltung_aendert(self, db):
        zeilen = await als(
            VERWALTUNG,
            "update public.sensor_einstellungen set abfrage_sekunden = 60,"
            " temperatur_min = 18 returning abfrage_sekunden, temperatur_min",
        )
        assert zeilen == [{"abfrage_sekunden": 60, "temperatur_min": 18}]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sekunden", [-1, 86401])
    async def test_der_takt_bleibt_im_bereich(self, db, sekunden):
        with pytest.raises(Exception, match="abfrage_sekunden"):
            await als(
                VERWALTUNG,
                "update public.sensor_einstellungen set abfrage_sekunden = :s",
                s=sekunden,
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sekunden", [0, 1, 30, 3600, 86400])
    async def test_freie_ganze_sekunden_einschliesslich_null(self, db, sekunden):
        """0 = aus, sonst jede ganze Sekunde bis 86400 — kein Mindestwert, kein
        Aufrunden eines Werts unter einer Minute."""
        zeilen = await als(
            VERWALTUNG,
            "update public.sensor_einstellungen set abfrage_sekunden = :s"
            " returning abfrage_sekunden",
            s=sekunden,
        )
        assert zeilen == [{"abfrage_sekunden": sekunden}]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "setzen",
        ["temperatur_min = 30, temperatur_max = 30", "feuchte_min = 80, feuchte_max = 70"],
    )
    async def test_min_liegt_unter_max(self, db, setzen):
        with pytest.raises(Exception, match="der_reihe_nach"):
            await als(VERWALTUNG, f"update public.sensor_einstellungen set {setzen}")

    @pytest.mark.asyncio
    async def test_eine_leere_grenze_ist_erlaubt(self, db):
        zeilen = await als(
            VERWALTUNG,
            "update public.sensor_einstellungen set feuchte_max = null returning feuchte_max",
        )
        assert zeilen == [{"feuchte_max": None}]


class TestTakt:
    """SET-10: `pg_cron` klopft jede Minute, die Datenbank entscheidet, ob es
    Zeit ist. Kein zweiter Zeitplan, kein Zustand in `compute`."""

    @pytest.mark.asyncio
    async def test_ohne_jeden_durchgang_ist_es_faellig(self, db):
        assert (await sql("select public.sensoren_faellig() as f"))[0]["f"] is True

    @pytest.mark.asyncio
    async def test_kurz_nach_einem_durchgang_nicht(self, db):
        await sql(
            "insert into public.sensor_versuche (sensor_id, versucht_am, erfolg)"
            " values (:s, now() - interval '10 minutes', true)",
            s=await sensor_id(),
        )
        assert (await sql("select public.sensoren_faellig() as f"))[0]["f"] is False

    @pytest.mark.asyncio
    async def test_nach_dem_intervall_wieder(self, db):
        await sql(
            "insert into public.sensor_versuche (sensor_id, versucht_am, erfolg)"
            " values (:s, now() - interval '61 minutes', false)",
            s=await sensor_id(),
        )
        assert (await sql("select public.sensoren_faellig() as f"))[0]["f"] is True

    @pytest.mark.asyncio
    async def test_der_takt_kommt_aus_der_einstellung(self, db):
        await sql("update public.sensor_einstellungen set abfrage_sekunden = 300")
        await sql(
            "insert into public.sensor_versuche (sensor_id, versucht_am, erfolg)"
            " values (:s, now() - interval '6 minutes', true)",
            s=await sensor_id(),
        )
        assert (await sql("select public.sensoren_faellig() as f"))[0]["f"] is True

    @pytest.mark.asyncio
    async def test_eine_minute_spaeter_klopfen_verschiebt_den_takt_nicht(self, db):
        """Der Durchgang schreibt seinen Versuch ein paar Sekunden nach dem
        Anklopfen. Ohne Toleranz liefe der Stundentakt jede Stunde eine Minute
        weiter."""
        await sql(
            "insert into public.sensor_versuche (sensor_id, versucht_am, erfolg)"
            " values (:s, now() - interval '59 minutes 45 seconds', true)",
            s=await sensor_id(),
        )
        assert (await sql("select public.sensoren_faellig() as f"))[0]["f"] is True

    @pytest.mark.asyncio
    async def test_ein_angestossener_lauf_zaehlt_schon(self, db):
        """Ein Lauf ohne Antwort hinterlässt noch keinen Versuch — der
        Anstoß selbst hält den Takt."""
        await sql("update public.sensor_einstellungen set letzter_anstoss = now()")
        assert (await sql("select public.sensoren_faellig() as f"))[0]["f"] is False

    @pytest.mark.asyncio
    async def test_null_schaltet_den_takt_ab(self, db):
        """0 = aus: ohne jeden Durchgang wäre es sonst fällig — bei 0 nie."""
        await sql("update public.sensor_einstellungen set abfrage_sekunden = 0")
        assert (await sql("select public.sensoren_faellig() as f"))[0]["f"] is False

    @pytest.mark.asyncio
    async def test_bei_null_ruft_er_niemanden_an(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("select set_config('acm.sensor_token', 'x', true)"))
                await s.execute(
                    sa.text("update public.sensor_einstellungen set abfrage_sekunden = 0")
                )
                ergebnis = (
                    await s.execute(sa.text("select public.sensoren_messen_anstossen()"))
                ).scalar()
        assert ergebnis is None

    @pytest.mark.asyncio
    async def test_nicht_faellig_ruft_er_niemanden_an(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("select set_config('acm.sensor_token', 'x', true)"))
                await s.execute(sa.text("update public.sensor_einstellungen set letzter_anstoss = now()"))
                ergebnis = (
                    await s.execute(sa.text("select public.sensoren_messen_anstossen()"))
                ).scalar()
        assert ergebnis is None

    @pytest.mark.asyncio
    async def test_faellig_ruft_er_an_und_merkt_es_sich(self, db):
        """Im Test gibt es kein `pg_net` — dass er es versucht, zeigt der
        Fehler. Gemerkt wird der Anstoß in derselben Transaktion."""
        async with SessionLocal() as s:
            with pytest.raises(Exception, match="net"):
                async with s.begin():
                    await s.execute(sa.text("select set_config('acm.sensor_token', 'x', true)"))
                    await s.execute(sa.text("select public.sensoren_messen_anstossen()"))


class TestAufraeumen:
    """Die Zeitreihe bleibt für immer; nur das Betriebsprotokoll wird gekürzt."""

    @pytest.mark.asyncio
    async def test_messwerte_bleiben_auch_nach_jahren(self, db):
        """Eine fünf Jahre alte Messung überlebt das Aufräumen — Sensormessdaten
        werden nie automatisch gelöscht."""
        sid = await sensor_id()
        await sql(
            "insert into public.sensor_messungen (sensor_id, gemessen_am, temperatur)"
            " values (:s, now() - interval '5 years', 20.5)",
            s=sid,
        )
        await sql("select public.sensoren_aufraeumen()")
        uebrig = (
            await sql(
                "select count(*) as n from public.sensor_messungen"
                " where gemessen_am < now() - interval '4 years'"
            )
        )[0]["n"]
        assert uebrig == 1

    @pytest.mark.asyncio
    async def test_alte_versuche_werden_gekuerzt(self, db):
        """Das Betriebsprotokoll darf weiter altern: älter als vierzehn Tage
        geht es fort."""
        sid = await sensor_id()
        await sql(
            "insert into public.sensor_versuche (sensor_id, versucht_am, erfolg)"
            " values (:s, now() - interval '30 days', true)",
            s=sid,
        )
        await sql("select public.sensoren_aufraeumen()")
        alt = (
            await sql(
                "select count(*) as n from public.sensor_versuche"
                " where versucht_am < now() - interval '15 days'"
            )
        )[0]["n"]
        assert alt == 0


BIS = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)


async def messungen(*zeilen: tuple[str, float | None, float | None]):
    sid = await sensor_id()
    for wann, temperatur, feuchte in zeilen:
        await sql(
            "insert into public.sensor_messungen (sensor_id, gemessen_am, temperatur, feuchte)"
            " values (:s, :w, :t, :f)",
            s=sid, w=datetime.fromisoformat(wann), t=temperatur, f=feuchte,
        )
    return sid


class TestVerlauf:
    """SEN-03: der Verlauf kommt verdichtet aus der Datenbank — 30 Tage sind
    sonst 50.000 Zeilen und laufen in die Grenze von PostgREST."""

    @pytest.mark.asyncio
    async def test_bis_24_stunden_in_fuenf_minuten(self, db):
        await messungen(
            ("2026-09-10 11:50:00+00", 21.0, 40.0),
            ("2026-09-10 11:52:00+00", 23.0, None),
            ("2026-09-10 11:40:00+00", 20.0, 44.0),
            ("2026-09-10 09:00:00+00", 30.0, 50.0),
        )
        zeilen = await als(
            LESER,
            "select zeit, temperatur, feuchte from public.sensor_verlauf(1, :b)",
            b=BIS,
        )
        assert [(str(z["zeit"])[11:16], float(z["temperatur"]), z["feuchte"]) for z in zeilen] == [
            ("11:40", 20.0, 44),
            ("11:50", 22.0, 40),
        ]

    @pytest.mark.asyncio
    async def test_darueber_in_stunden(self, db):
        await messungen(
            ("2026-09-10 11:50:00+00", 21.0, 40.0),
            ("2026-09-10 11:10:00+00", 23.0, 42.0),
            ("2026-09-08 09:00:00+00", 30.0, 50.0),
        )
        zeilen = await als(
            LESER, "select zeit, temperatur from public.sensor_verlauf(720, :b)", b=BIS
        )
        assert [(str(z["zeit"])[:13], float(z["temperatur"])) for z in zeilen] == [
            ("2026-09-08 09", 30.0),
            ("2026-09-10 11", 22.0),
        ]

    @pytest.mark.asyncio
    async def test_er_haelt_sich_an_die_policy(self, db):
        await messungen(("2026-09-10 11:50:00+00", 21.0, 40.0))
        assert await als(FREMD, "select * from public.sensor_verlauf(1, :b)", b=BIS) == []


class TestKennzahlen:
    """SEN-02: Min/Max im Fenster und die Änderung zu vor 1 h und 24 h — aus
    echten Messungen. Fehlt die Vergleichsmessung, fehlt die Änderung."""

    @pytest.mark.asyncio
    async def test_min_max_und_aenderung(self, db):
        await messungen(
            ("2026-09-10 12:00:00+00", 22.0, 45.0),
            ("2026-09-10 11:02:00+00", 21.0, None),
            ("2026-09-10 10:40:00+00", 20.0, 50.0),
            ("2026-09-09 08:00:00+00", 10.0, 90.0),
        )
        zeilen = await als(LESER, "select * from public.sensor_kennzahlen(24, :b)", b=BIS)
        assert len(zeilen) == 1
        z = zeilen[0]
        assert float(z["temperatur"]) == 22.0
        assert (float(z["temperatur_min"]), float(z["temperatur_max"])) == (20.0, 22.0)
        assert (float(z["feuchte_min"]), float(z["feuchte_max"])) == (45.0, 50.0)
        # Vor einer Stunde: 11:02 liegt am nächsten an 11:00.
        assert float(z["temperatur_aenderung_1h"]) == 1.0
        # Die Feuchte fehlt um 11:02 — die nächste Feuchte im Toleranzfenster
        # ist 10:40.
        assert float(z["feuchte_aenderung_1h"]) == -5.0
        # Vor 24 Stunden gibt es innerhalb einer halben Stunde nichts.
        assert z["temperatur_aenderung_24h"] is None
        assert z["feuchte_aenderung_24h"] is None

    @pytest.mark.asyncio
    async def test_ein_geraet_ohne_messung_bleibt_leer_statt_null(self, db):
        zeilen = await als(LESER, "select * from public.sensor_kennzahlen(24, :b)", b=BIS)
        assert len(zeilen) == 1
        assert zeilen[0]["temperatur"] is None
        assert zeilen[0]["temperatur_min"] is None
        assert zeilen[0]["temperatur_aenderung_1h"] is None

    @pytest.mark.asyncio
    async def test_er_haelt_sich_an_die_policy(self, db):
        await messungen(("2026-09-10 11:50:00+00", 21.0, 40.0))
        assert await als(FREMD, "select * from public.sensor_kennzahlen(24, :b)", b=BIS) == []

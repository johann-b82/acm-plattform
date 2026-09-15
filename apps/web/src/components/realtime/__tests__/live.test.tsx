/**
 * Live-Aktualisierung und Anwesenheit (ADR-0006) — gegen einen nachgebildeten
 * Kanal. Geprüft wird, was die Oberfläche selbst verantwortet: welche Kanäle
 * sie privat abonniert, was eine Meldung neu lädt, dass sie beim Verlassen
 * aufräumt, und wen die Anwesenheit nennt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Handler = (nachricht?: unknown) => void;

interface KanalAttrappe {
  thema: string;
  optionen: unknown;
  broadcast: Map<string, Handler>;
  presence: Map<string, Handler>;
  status: Handler | null;
  track: ReturnType<typeof vi.fn>;
  zustand: Record<string, { kennung?: string; email?: string }[]>;
}

const kanaele = vi.hoisted(() => [] as KanalAttrappe[]);
const entfernt = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    realtime: { setAuth: vi.fn(async () => undefined) },
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "ich", email: "ich@acm.local" } } })),
    },
    channel: (thema: string, optionen: unknown) => {
      const k: KanalAttrappe = {
        thema,
        optionen,
        broadcast: new Map(),
        presence: new Map(),
        status: null,
        track: vi.fn(async () => "ok"),
        zustand: {},
      };
      kanaele.push(k);
      const kanal = {
        on: (art: string, filter: { event: string }, handler: Handler) => {
          (art === "broadcast" ? k.broadcast : k.presence).set(filter.event, handler);
          return kanal;
        },
        subscribe: (rueckruf: Handler) => {
          k.status = rueckruf;
          return kanal;
        },
        track: k.track,
        presenceState: () => k.zustand,
        thema,
      };
      return kanal;
    },
    removeChannel: vi.fn(async (kanal: { thema: string }) => {
      entfernt.push(kanal.thema);
    }),
  }),
}));

const toastFehler = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastFehler, success: vi.fn() } }));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { KonfliktFehler } from "@/lib/realtime";
import { Anwesenheit } from "../anwesenheit";
import { useKonfliktMeldung } from "../konflikt";
import { useLiveTabellen } from "../live";

function LiveProbe({ tabellen }: { tabellen: string[] }) {
  useLiveTabellen(tabellen);
  return null;
}

function mitAnbietern(inhalt: React.ReactNode, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <SprachAnbieter sprache="de">{inhalt}</SprachAnbieter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  kanaele.length = 0;
  entfernt.length = 0;
});

describe("useLiveTabellen", () => {
  it("abonniert je Tabelle einen privaten Kanal", async () => {
    mitAnbietern(<LiveProbe tabellen={["atr_lieferungen", "atr_positionen"]} />);
    await waitFor(() => expect(kanaele).toHaveLength(2));
    expect(kanaele.map((k) => k.thema)).toEqual(["tabelle:atr_lieferungen", "tabelle:atr_positionen"]);
    for (const k of kanaele) {
      expect(k.optionen).toMatchObject({ config: { private: true } });
      expect(k.broadcast.has("aenderung")).toBe(true);
    }
  });

  it("lädt bei einer Meldung die Abfragen des Moduls neu", async () => {
    const client = new QueryClient();
    const neuLaden = vi.spyOn(client, "invalidateQueries");
    mitAnbietern(<LiveProbe tabellen={["audits"]} />, client);
    await waitFor(() => expect(kanaele).toHaveLength(1));
    act(() => kanaele[0].broadcast.get("aenderung")!({ payload: { tabelle: "audits", op: "UPDATE" } }));
    expect(neuLaden).toHaveBeenCalledWith({ queryKey: ["audit"] });
  });

  it("räumt die Kanäle beim Verlassen der Seite ab", async () => {
    const { unmount } = mitAnbietern(<LiveProbe tabellen={["maschinen"]} />);
    await waitFor(() => expect(kanaele).toHaveLength(1));
    unmount();
    await waitFor(() => expect(entfernt).toEqual(["tabelle:maschinen"]));
  });
});

describe("Anwesenheit", () => {
  it("meldet sich selbst an und nennt die anderen, die den Datensatz offen haben", async () => {
    mitAnbietern(<Anwesenheit tabelle="atr_lieferungen" kennung="l1" />);
    await waitFor(() => expect(kanaele).toHaveLength(1));
    const k = kanaele[0];
    expect(k.thema).toBe("datensatz:atr_lieferungen:l1");
    expect(k.optionen).toMatchObject({ config: { private: true } });

    await act(async () => k.status!("SUBSCRIBED"));
    expect(k.track).toHaveBeenCalledWith({ kennung: "ich", email: "ich@acm.local" });

    k.zustand = {
      a: [{ kennung: "ich", email: "ich@acm.local" }],
      b: [{ kennung: "u2", email: "zoe@acm.local" }],
    };
    act(() => k.presence.get("sync")!());
    expect(await screen.findByText("Auch geöffnet von zoe@acm.local")).toBeInTheDocument();
  });

  it("zeigt nichts, solange niemand sonst da ist", async () => {
    const { container } = mitAnbietern(<Anwesenheit tabelle="audits" kennung="a1" />);
    await waitFor(() => expect(kanaele).toHaveLength(1));
    kanaele[0].zustand = { a: [{ kennung: "ich", email: "ich@acm.local" }] };
    act(() => kanaele[0].presence.get("sync")!());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("useKonfliktMeldung", () => {
  function melder(client = new QueryClient()) {
    const neuLaden = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useKonfliktMeldung(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <SprachAnbieter sprache="de">{children}</SprachAnbieter>
        </QueryClientProvider>
      ),
    });
    return { melde: result.current, neuLaden };
  }

  it("sagt, dass jemand schneller war, und lädt den aktuellen Stand", () => {
    toastFehler.mockClear();
    const { melde, neuLaden } = melder();
    melde(new KonfliktFehler("konflikt"));
    expect(toastFehler).toHaveBeenCalledWith(
      "Inzwischen von jemand anderem geändert — der aktuelle Stand ist geladen.",
    );
    expect(neuLaden).toHaveBeenCalled();
  });

  it("sagt, dass jemand gelöscht hat", () => {
    toastFehler.mockClear();
    const { melde } = melder();
    melde(new KonfliktFehler("geloescht"));
    expect(toastFehler).toHaveBeenCalledWith("Inzwischen von jemand anderem gelöscht.");
  });

  it("überlässt andere Fehler der Seite oder zeigt ihren Text", () => {
    toastFehler.mockClear();
    const { melde, neuLaden } = melder();
    const sonst = vi.fn();
    const fehler = new Error("violates check constraint audits_zeitraum");
    melde(fehler, sonst);
    expect(sonst).toHaveBeenCalledWith(fehler);
    expect(toastFehler).not.toHaveBeenCalled();
    melde(new Error("Netz weg"));
    expect(toastFehler).toHaveBeenCalledWith("Netz weg");
    expect(neuLaden).not.toHaveBeenCalled();
  });
});

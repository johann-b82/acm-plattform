/**
 * Signage in der Schale: die Bereichsnavigation und die seitenweiten Aktionen
 * (Medien hinzufügen, Neue Playlist, Neuer Zeitplan, Gerät koppeln, im Editor
 * Zurück/Verwerfen/Speichern) stehen in der rechten Leiste, nicht im Inhalt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/signage/playlists",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/plattform-einstellungen", () => ({ useSeitengroesse: () => 25 }));

const STEMPEL = { created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
const PLAYLIST = {
  id: "p1",
  name: "Foyer",
  description: null,
  enabled: true,
  priority: 0,
  tag_ids: [],
  ...STEMPEL,
};

vi.mock("@/lib/signage/api", async (original) => {
  const echt = await original<typeof import("@/lib/signage/api")>();
  return {
    ...echt,
    signageApi: {
      ...echt.signageApi,
      listTags: vi.fn(async () => []),
      listMedia: vi.fn(async () => []),
      listPlaylists: vi.fn(async () => [PLAYLIST]),
      getPlaylist: vi.fn(async () => PLAYLIST),
      listPlaylistItems: vi.fn(async () => []),
      listSchedules: vi.fn(async () => [
        {
          id: "s1",
          playlist_id: "p1",
          weekday_mask: 31,
          start_hhmm: 800,
          end_hhmm: 1700,
          priority: 0,
          enabled: true,
          ...STEMPEL,
        },
      ]),
      listDevices: vi.fn(async () => [
        {
          id: "d1",
          name: "Empfang",
          status: "online",
          last_seen_at: null,
          revoked_at: null,
          tag_ids: [],
          current_playlist_id: null,
          current_playlist_name: null,
          rotation: 0,
          hdmi_mode: null,
          audio_enabled: false,
          mac_address: null,
          hostname: null,
          ip_address: null,
          ...STEMPEL,
        },
      ]),
      listDeviceAnalytics: vi.fn(async () => []),
    },
  };
});

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { Werkzeugplatz } from "@/components/sidebar/werkzeugplatz";
import { SignageTabs } from "../tabs";
import { MediaAdmin } from "../media/media-admin";
import { PlaylistsAdmin } from "../playlists/playlists-admin";
import { SchedulesAdmin } from "../schedules/schedules-admin";
import { DevicesAdmin } from "../devices/devices-admin";
import { PlaylistEditor } from "../playlists/[id]/playlist-editor";

let platz: HTMLElement;
beforeEach(() => {
  platz = document.createElement("div");
  document.body.appendChild(platz);
});
afterEach(() => platz.remove());

function zeige(kinder: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SprachAnbieter sprache="de">
        <Werkzeugplatz.Provider value={platz}>
          <main data-testid="inhalt">{kinder}</main>
        </Werkzeugplatz.Provider>
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Signage in der rechten Leiste", () => {
  it("führt die Bereiche als senkrechte Liste in der Leiste", () => {
    zeige(<SignageTabs />);
    const nav = screen.getByRole("navigation", { name: "Signage-Bereiche" });
    expect(platz).toContainElement(nav);
    expect(nav.className).toContain("flex-col");
    expect(screen.getByRole("link", { name: "Playlists" }).getAttribute("aria-current")).toBe("page");
  });

  it("stellt „Medien hinzufügen“ in die Leiste, die Medien bleiben im Inhalt", async () => {
    zeige(<MediaAdmin />);
    expect(platz).toContainElement(screen.getByRole("heading", { name: "Medien hinzufügen" }));
    expect(platz).toContainElement(screen.getByRole("button", { name: "Datei auswählen" }));
    expect(await screen.findByText("Noch keine Medien")).not.toBeNull();
    expect(platz).not.toContainElement(screen.getByText("Noch keine Medien"));
  });

  it("stellt „Neue Playlist“ in die Leiste", async () => {
    zeige(<PlaylistsAdmin />);
    const knopf = await screen.findByRole("button", { name: "Neue Playlist" });
    expect(platz).toContainElement(knopf);
    expect(platz).not.toContainElement(screen.getByRole("link", { name: "Foyer" }));
  });

  it("stellt „Neuer Zeitplan“ in die Leiste", async () => {
    zeige(<SchedulesAdmin />);
    expect(platz).toContainElement(await screen.findByRole("button", { name: "Neuer Zeitplan" }));
  });

  it("stellt „Gerät koppeln“ in die Leiste und koppelt weiter", async () => {
    zeige(<DevicesAdmin />);
    const knopf = await screen.findByRole("button", { name: "Gerät koppeln" });
    expect(platz).toContainElement(knopf);
    knopf.click();
    expect(push).toHaveBeenCalledWith("/signage/pair");
  });

  it("stellt im Editor Zurück, Verwerfen und Speichern in die Leiste", async () => {
    zeige(<PlaylistEditor playlistId="p1" />);
    const zurueck = await screen.findByRole("link", { name: /Alle Playlists/ });
    expect(platz).toContainElement(zurueck);
    expect(platz).toContainElement(screen.getByRole("button", { name: "Verwerfen" }));
    expect(platz).toContainElement(screen.getByRole("button", { name: "Speichern" }));
    // Name und Tags bleiben im Inhalt.
    expect(platz).not.toContainElement(screen.getByLabelText("Name"));
  });
});

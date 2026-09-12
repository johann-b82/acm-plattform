/**
 * Die Hochladeseite bietet alle vierzehn Importe des Altsystems (UPL-01) —
 * die Materialpreise (Wareneingang) als eigene Kachel neben dem Wareneingang
 * und der Artikel-Preisliste, mit eigener Route.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const computeJson = vi.hoisted(() =>
  vi.fn(async () => ({
    batch_id: 1,
    filename: "AswKpf_WE.txt",
    kind: "materialpreise",
    rows_total: 1,
    rows_inserted: 1,
    rows_updated: 0,
    status: "success",
    errors: [],
  })),
);

vi.mock("@/lib/compute", () => ({ computeJson }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    }),
  }),
}));

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { UploadsAdmin } from "../uploads-admin";

function zeige() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SprachAnbieter sprache="de">
        <UploadsAdmin />
      </SprachAnbieter>
    </QueryClientProvider>,
  );
}

describe("Hochladeseite", () => {
  it("bietet vierzehn Importe", () => {
    zeige();
    expect(screen.getAllByRole("button", { name: "Datei auswählen" })).toHaveLength(14);
  });

  it("führt Materialpreise getrennt von Wareneingang und Artikel-Preisliste", () => {
    zeige();
    expect(screen.getByRole("heading", { name: "Materialpreise (Wareneingang)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wareneingänge" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Artikelpreise Lager" })).toBeInTheDocument();
  });

  it("schickt die Datei an die eigene Route", async () => {
    const { container } = zeige();
    const karte = screen.getByRole("heading", { name: "Materialpreise (Wareneingang)" }).parentElement!;
    const eingabe = karte.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(container.contains(eingabe)).toBe(true);
    fireEvent.change(eingabe, { target: { files: [new File(["x"], "AswKpf_WE.txt")] } });
    await waitFor(() =>
      expect(computeJson).toHaveBeenCalledWith(
        "/api/uploads/materialpreise",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

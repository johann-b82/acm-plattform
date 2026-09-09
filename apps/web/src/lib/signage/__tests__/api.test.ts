import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, mediaFileUrl, signageApi, slideUrl } from "../api";
import type { SignageMedia } from "../types";

function media(overrides: Partial<SignageMedia>): SignageMedia {
  return {
    id: "m1",
    kind: "image",
    title: "Bild",
    uri: "files/abc.png",
    html_content: null,
    mime_type: "image/png",
    size_bytes: 1,
    duration_ms: null,
    conversion_status: null,
    conversion_error: null,
    slide_paths: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mediaFileUrl", () => {
  it("zeigt Dateien über den Proxy, nicht über den Pfad im Volume", () => {
    expect(mediaFileUrl(media({}))).toBe("/api/signage/media/m1/file");
  });

  it("gibt bei kind=url die Adresse selbst zurück", () => {
    expect(mediaFileUrl(media({ kind: "url", uri: "https://acm.local/embed/x" }))).toBe(
      "https://acm.local/embed/x",
    );
  });

  it("liefert null, wenn keine Datei dahintersteht", () => {
    expect(mediaFileUrl(media({ kind: "html", uri: null }))).toBeNull();
    expect(mediaFileUrl(media({ uri: "/etc/passwd" }))).toBeNull();
  });

  it("nummeriert Folien ab 1", () => {
    expect(slideUrl("m1", 3)).toBe("/api/signage/media/m1/slide/3");
  });
});

describe("Fehlerbehandlung", () => {
  it("hebt Status und Körper auf, damit 409 auswertbar bleibt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: "media in use by playlists", playlist_ids: ["p1"] }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(signageApi.deleteMedia("m1")).rejects.toMatchObject({
      status: 409,
      message: "media in use by playlists",
      body: { playlist_ids: ["p1"] },
    });
  });

  it("nutzt den Status als Meldung, wenn kein detail kommt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(signageApi.listTags()).rejects.toBeInstanceOf(ApiError);
    await expect(signageApi.listTags()).rejects.toThrow("HTTP 502");
  });
});

describe("resolveTagIds", () => {
  it("nutzt vorhandene Tags und legt nur unbekannte an", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ id: 99, name: "neu" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify([{ id: 7, name: "empfang" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await expect(signageApi.resolveTagIds(["empfang", "neu"])).resolves.toEqual([7, 99]);
    expect(calls).toEqual(["GET /api/signage/tags", "POST /api/signage/tags"]);
  });
});

describe("uploadMedia", () => {
  it("schickt PPTX an die Konvertierungsroute, andere Dateien an den Upload", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ id: "x" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await signageApi.uploadMedia(new File([""], "folien.pptx"), "Folien");
    await signageApi.uploadMedia(new File([""], "bild.png"), "Bild");
    expect(seen).toEqual(["/api/signage/media/pptx", "/api/signage/media/upload"]);
  });
});

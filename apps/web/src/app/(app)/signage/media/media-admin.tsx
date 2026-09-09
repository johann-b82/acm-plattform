"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Code, FileText, Link as LinkIcon, Loader2, Presentation, RotateCcw } from "lucide-react";

import { ApiError, mediaFileUrl, signageApi, signageKeys } from "@/lib/signage/api";
import type { SignageMedia } from "@/lib/signage/types";
import { Badge, Button, Card, EmptyState, Input, Label, Select } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { ConversionBadge } from "@/components/signage/status";
import { cn } from "@/lib/cn";

const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.pptx";

function KindIcon({ kind }: { kind: SignageMedia["kind"] }) {
  const cls = "h-8 w-8 text-[var(--fg-muted)]";
  if (kind === "url") return <LinkIcon className={cls} aria-hidden />;
  if (kind === "html") return <Code className={cls} aria-hidden />;
  if (kind === "pptx") return <Presentation className={cls} aria-hidden />;
  return <FileText className={cls} aria-hidden />;
}

export function MediaAdmin() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [inUse, setInUse] = useState<{ title: string; playlistIds: string[] } | null>(null);
  const [urlKind, setUrlKind] = useState<"url" | "html">("url");
  const [urlTitle, setUrlTitle] = useState("");
  const [urlContent, setUrlContent] = useState("");

  // Solange eine PPTX-Datei konvertiert, kurz nachfragen; sonst ruhig bleiben.
  const mediaQuery = useQuery({
    queryKey: signageKeys.media(),
    queryFn: signageApi.listMedia,
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (m) => m.conversion_status === "pending" || m.conversion_status === "processing",
      )
        ? 3000
        : false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: signageKeys.media() });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => signageApi.uploadMedia(file, file.name),
    onSuccess: (media) => {
      invalidate();
      toast.success(
        media.kind === "pptx" ? `„${media.title}“ wird konvertiert.` : `„${media.title}“ hochgeladen.`,
      );
    },
    onError: (err: Error) => toast.error(`Upload fehlgeschlagen: ${err.message}`),
  });

  const createUrlMutation = useMutation({
    mutationFn: () =>
      signageApi.createUrlMedia(
        urlKind === "url"
          ? { kind: "url", title: urlTitle.trim(), uri: urlContent.trim() }
          : { kind: "html", title: urlTitle.trim(), html_content: urlContent },
      ),
    onSuccess: () => {
      invalidate();
      toast.success(urlKind === "url" ? "URL aufgenommen." : "HTML-Schnipsel aufgenommen.");
      setUrlTitle("");
      setUrlContent("");
    },
    onError: (err: Error) => toast.error(`Anlegen fehlgeschlagen: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (media: SignageMedia) => signageApi.deleteMedia(media.id),
    onSuccess: () => {
      invalidate();
      toast.success("Medium gelöscht.");
    },
    onError: (err: unknown, media) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { playlist_ids?: string[] } | null;
        setInUse({ title: media.title, playlistIds: body?.playlist_ids ?? [] });
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      toast.error(`Löschen fehlgeschlagen: ${detail}`);
    },
  });

  const reconvertMutation = useMutation({
    mutationFn: (id: string) => signageApi.reconvertMedia(id),
    onSuccess: () => {
      invalidate();
      toast.success("Konvertierung neu gestartet.");
    },
    onError: (err: Error) => toast.error(`Neustart fehlgeschlagen: ${err.message}`),
  });

  const media = mediaQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-base font-semibold">Medien hinzufügen</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          {/* Datei-Ablage */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
            className={cn(
              "flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors",
              dragActive ? "border-[var(--ring)] bg-[var(--muted)]" : "border-[var(--border)]",
              uploadMutation.isPending && "opacity-60",
            )}
          >
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = "";
              }}
            />
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-[var(--fg-muted)]" />
                <span className="text-xs text-[var(--fg-muted)]">wird übertragen …</span>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Datei hierher ziehen</p>
                <Button onClick={() => fileInput.current?.click()}>Datei auswählen</Button>
                <p className="text-xs text-[var(--fg-muted)]">
                  Bild, Video, PDF oder PPTX, bis 50 MB
                </p>
              </>
            )}
          </div>

          {/* URL oder HTML */}
          <form
            className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!urlTitle.trim() || !urlContent.trim()) return;
              createUrlMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="media-kind">Art</Label>
              <Select
                id="media-kind"
                value={urlKind}
                onChange={(e) => setUrlKind(e.target.value as "url" | "html")}
              >
                <option value="url">Webseite (URL)</option>
                <option value="html">HTML-Schnipsel</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="media-title">Titel</Label>
              <Input
                id="media-title"
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
                placeholder="Geburtstage"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="media-content">{urlKind === "url" ? "URL" : "HTML"}</Label>
              <Input
                id="media-content"
                value={urlContent}
                onChange={(e) => setUrlContent(e.target.value)}
                placeholder={
                  urlKind === "url" ? "https://acm.local/embed/birthdays" : "<h1>Hallo</h1>"
                }
                required
              />
              {urlKind === "url" && (
                <p className="text-xs text-[var(--fg-muted)]">
                  Vollständige Adresse angeben. Der Player läuft auf einem eigenen Port, relative
                  Pfade funktionieren dort nicht.
                </p>
              )}
            </div>
            <Button type="submit" disabled={createUrlMutation.isPending}>
              Aufnehmen
            </Button>
          </form>
        </div>
      </Card>

      {mediaQuery.isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg bg-[var(--muted)]" />
          ))}
        </div>
      )}

      {mediaQuery.isError && (
        <Card className="p-5 text-sm text-[var(--danger)]">
          Medien konnten nicht geladen werden.
        </Card>
      )}

      {mediaQuery.data && media.length === 0 && (
        <EmptyState
          title="Noch keine Medien"
          body="Lade eine Datei hoch oder nimm eine URL auf. Anschließend lassen sich die Medien in Playlists zusammenstellen."
        />
      )}

      {media.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((item) => {
            const thumb =
              item.kind === "image" || item.kind === "video" ? mediaFileUrl(item) : null;
            const slide =
              item.kind === "pptx" && item.slide_paths?.length
                ? `/api/signage/media/${item.id}/slide/1`
                : null;
            return (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
              >
                <div className="flex h-32 items-center justify-center overflow-hidden bg-[var(--muted)]">
                  {thumb && item.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Datei kommt über den Proxy, keine Optimierung möglich
                    <img src={thumb} alt="" className="h-32 w-full object-cover" />
                  ) : slide ? (
                    // eslint-disable-next-line @next/next/no-img-element -- siehe oben
                    <img src={slide} alt="" className="h-32 w-full object-contain" />
                  ) : (
                    <KindIcon kind={item.kind} />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold" title={item.title}>
                      {item.title}
                    </h3>
                    <Badge variant="outline" className="shrink-0">
                      {item.kind}
                    </Badge>
                  </div>
                  {item.kind === "pptx" && (
                    <div className="flex items-center gap-2">
                      <ConversionBadge status={item.conversion_status} error={item.conversion_error} />
                      {item.conversion_status === "failed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reconvertMutation.mutate(item.id)}
                          disabled={reconvertMutation.isPending}
                        >
                          <RotateCcw className="h-3 w-3" /> erneut
                        </Button>
                      )}
                    </div>
                  )}
                  {item.kind === "url" && item.uri && (
                    <p className="truncate text-xs text-[var(--fg-muted)]" title={item.uri}>
                      {item.uri}
                    </p>
                  )}
                  <div className="mt-auto flex justify-end">
                    <ConfirmDeleteButton
                      itemLabel={item.title}
                      onConfirm={async () => {
                        try {
                          await deleteMutation.mutateAsync(item);
                        } catch {
                          // Fehlerbehandlung sitzt in onError; hier nur den Dialog schließen.
                        }
                      }}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog
        open={inUse !== null}
        onOpenChange={(o) => !o && setInUse(null)}
        title="Medium wird verwendet"
        description={`„${inUse?.title ?? ""}“ ist noch in ${inUse?.playlistIds.length ?? 0} Playlist(s) eingebunden. Entferne es dort zuerst.`}
        footer={<Button onClick={() => setInUse(null)}>Verstanden</Button>}
      >
        {inUse && inUse.playlistIds.length > 0 && (
          <ul className="list-inside list-disc font-mono text-xs text-[var(--fg-muted)]">
            {inUse.playlistIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

import { PlaylistEditor } from "./playlist-editor";

export default async function PlaylistEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlaylistEditor playlistId={id} />;
}

-- Signage-Bestand für den Umschalt-Test, zusätzlich zu dem, was der Dump der
-- Entwicklungsdatenbank mitbringt (dort: eine Playlist mit fünf url-Medien).
--
-- Deckt ab, was die Übernahme in acm-signage (api/app/uebernahme.py) anfasst:
--   * ein gekoppeltes Gerät mit Tag
--   * ein Bild und eine PPTX, deren `uri` die Directus-Datei-UUID ist; die
--     Dateien liegen als directus_uploads/<uuid>.<ext>
--   * abgeleitete Folien unter backend/media/slides/<media_id>/
--   * Playlist mit Tag-Zuordnung, Zeitplan und einer abgelaufenen Kopplung
--
-- Feste UUIDs, `on conflict do nothing`: mehrfach einspielbar.
begin;

insert into directus_files (id, storage, filename_disk, filename_download, title, type, filesize)
values
  ('77777777-7777-4777-8777-777777777701', 'local', '77777777-7777-4777-8777-777777777701.png',
   'foyer.png', 'Foyer', 'image/png', 70),
  ('77777777-7777-4777-8777-777777777702', 'local', '77777777-7777-4777-8777-777777777702.pptx',
   'begruessung.pptx', 'Begrüßung',
   'application/vnd.openxmlformats-officedocument.presentationml.presentation', 300)
on conflict do nothing;

insert into signage_device_tags (id, name) values (9001, 'e2e-foyer')
on conflict do nothing;
select setval('signage_device_tags_id_seq', greatest(9001, (select max(id) from signage_device_tags)));

insert into signage_devices (id, name, device_token_hash, last_seen_at, status, hostname, ip_address)
values ('44444444-4444-4444-8444-444444444401', 'E2E Foyer-Pi', 'e2e-kein-echter-hash',
        now(), 'online', 'signage-pi', '10.213.0.20')
on conflict do nothing;

insert into signage_device_tag_map (device_id, tag_id)
values ('44444444-4444-4444-8444-444444444401', 9001)
on conflict do nothing;

insert into signage_media (id, kind, title, mime_type, size_bytes, uri)
values ('66666666-6666-4666-8666-666666666601', 'image', 'E2E Foyer-Bild', 'image/png', 70,
        '77777777-7777-4777-8777-777777777701')
on conflict do nothing;

insert into signage_media (id, kind, title, mime_type, size_bytes, uri, conversion_status, slide_paths)
values ('66666666-6666-4666-8666-666666666602', 'pptx', 'E2E Begrüßung',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', 300,
        '77777777-7777-4777-8777-777777777702', 'done',
        '["slides/66666666-6666-4666-8666-666666666602/slide-001.png",
          "slides/66666666-6666-4666-8666-666666666602/slide-002.png"]'::jsonb)
on conflict do nothing;

insert into signage_playlists (id, name, description, priority, enabled)
values ('55555555-5555-4555-8555-555555555501', 'E2E Foyer', 'Umschalt-Test', 10, true)
on conflict do nothing;

insert into signage_playlist_items (id, playlist_id, media_id, position, duration_s, transition)
values
  ('88888888-8888-4888-8888-888888888801', '55555555-5555-4555-8555-555555555501',
   '66666666-6666-4666-8666-666666666601', 0, 10, 'fade'),
  ('88888888-8888-4888-8888-888888888802', '55555555-5555-4555-8555-555555555501',
   '66666666-6666-4666-8666-666666666602', 1, 20, 'fade')
on conflict do nothing;

insert into signage_playlist_tag_map (playlist_id, tag_id)
values ('55555555-5555-4555-8555-555555555501', 9001)
on conflict do nothing;

insert into signage_schedules (id, playlist_id, weekday_mask, start_hhmm, end_hhmm, priority)
values ('99999999-9999-4999-8999-999999999901', '55555555-5555-4555-8555-555555555501',
        127, 0, 2359, 10)
on conflict do nothing;

insert into signage_pairing_sessions (id, code, device_id, expires_at, claimed_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'E2E001', '44444444-4444-4444-8444-444444444401',
        now() - interval '1 day', now() - interval '1 day')
on conflict do nothing;

commit;

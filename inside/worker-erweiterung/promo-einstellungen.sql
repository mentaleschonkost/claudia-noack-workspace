-- Einstellungen pro Promo-Bereich (YouTube-Link, Preis, Gegenleistung).
-- Rein ergänzend: bestehende Tabellen werden nicht verändert.
create table if not exists public.ms_promo_einstellungen (
  slug            text primary key
                  references public.ms_bereiche(slug) on update cascade on delete cascade,
  youtube_link    text,
  preis           text,
  gegenleistung   text,
  aktualisiert_am timestamptz not null default now()
);

-- Zugriff nur über den Worker (Service-Key); öffentlich nicht lesbar.
alter table public.ms_promo_einstellungen enable row level security;

-- ══════════════════════════════════════════
--  SPINREC — Schema Supabase
--  Cole isso no SQL Editor do painel Supabase
-- ══════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- ── Histórico de álbuns ──────────────────────────────────────────
create table public.albums_history (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  album_id      text not null,
  name          text not null,
  artist        text not null,
  year          text,
  image         text,
  genres        text[],
  popularity    integer default 0,
  url           text,
  lastfm_url    text,
  label         text,
  country       text,
  mbid          text,
  rating        numeric(2,1) default 0,
  listened      boolean default false,
  favorite      boolean default false,
  note          text default '',
  sources       jsonb default '{}',
  discovered_at timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(user_id, album_id)
);

-- ── Wishlist ─────────────────────────────────────────────────────
create table public.wishlist (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  album_id      text not null,
  name          text not null,
  artist        text not null,
  image         text,
  added_at      timestamptz default now(),
  unique(user_id, album_id)
);

-- ── Row Level Security ───────────────────────────────────────────
alter table public.albums_history enable row level security;
alter table public.wishlist       enable row level security;

-- albums_history
create policy "select_own_history"
  on public.albums_history for select
  using (auth.uid() = user_id);

create policy "insert_own_history"
  on public.albums_history for insert
  with check (auth.uid() = user_id);

create policy "update_own_history"
  on public.albums_history for update
  using (auth.uid() = user_id);

create policy "delete_own_history"
  on public.albums_history for delete
  using (auth.uid() = user_id);

-- wishlist
create policy "select_own_wishlist"
  on public.wishlist for select
  using (auth.uid() = user_id);

create policy "insert_own_wishlist"
  on public.wishlist for insert
  with check (auth.uid() = user_id);

create policy "delete_own_wishlist"
  on public.wishlist for delete
  using (auth.uid() = user_id);

-- ── Índices ──────────────────────────────────────────────────────
create index idx_history_user_date
  on public.albums_history(user_id, discovered_at desc);

create index idx_wishlist_user_date
  on public.wishlist(user_id, added_at desc);

-- Shared admin settings. Run once in Supabase → SQL Editor.
--
-- Holds the Automation tab's configuration (graveyard pool, fixed shifts, the
-- Apps Script web-app URL and its sync token) so it is entered once and follows
-- every admin to every device, instead of living in one browser's localStorage.

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Admins only, read and write. The sync token lives here, so it must never be
-- readable by ordinary agents.
drop policy if exists "settings_admin_all" on public.app_settings;
create policy "settings_admin_all" on public.app_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Shift requests: agents ask, admins act. Run once in Supabase → SQL Editor.

-- Helper: the agent id for the logged-in user (security definer avoids recursion)
create or replace function public.current_agent_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select id from public.agents
  where lower(trim(email)) = lower(trim(auth.jwt() ->> 'email'))
  limit 1;
$$;

create table if not exists public.requests (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  message    text not null,
  status     text not null default 'open' check (status in ('open','resolved','dismissed')),
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.requests enable row level security;

-- Agents see their own requests; admins see all.
drop policy if exists "requests_read" on public.requests;
create policy "requests_read" on public.requests for select to authenticated
  using (public.is_admin() or agent_id = public.current_agent_id());

-- Agents can submit a request only as themselves.
drop policy if exists "requests_insert" on public.requests;
create policy "requests_insert" on public.requests for insert to authenticated
  with check (agent_id = public.current_agent_id());

-- Admins update status / notes.
drop policy if exists "requests_admin_update" on public.requests;
create policy "requests_admin_update" on public.requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Owners can withdraw their own request; admins can delete any.
drop policy if exists "requests_delete" on public.requests;
create policy "requests_delete" on public.requests for delete to authenticated
  using (public.is_admin() or agent_id = public.current_agent_id());

-- Agent row order for the schedule sheet. Run once in Supabase → SQL Editor.
--
-- Purely presentational: the generator sorts by name internally when handing
-- out off-patterns, so reordering rows never changes anyone's schedule.

alter table public.agents
  add column if not exists sort_order integer;

-- Seed from the current alphabetical order, in steps of 10 so rows can be
-- slotted between existing ones without renumbering everything.
with ranked as (
  select id, (row_number() over (order by name)) * 10 as rn
  from public.agents
)
update public.agents a
set sort_order = r.rn
from ranked r
where a.id = r.id and a.sort_order is null;

select name, sort_order from public.agents order by sort_order nulls last, name;

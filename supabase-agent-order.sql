-- Agent row order for the schedule sheet. Run once in Supabase → SQL Editor.
--
-- Purely presentational: the generator sorts by name internally when handing
-- out off-patterns, so reordering rows never changes anyone's schedule.

alter table public.agents
  add column if not exists sort_order integer;

-- Also ensure the specialist flag exists, so this file works on its own even if
-- supabase-specialist.sql has not been run yet.
alter table public.agents
  add column if not exists is_specialist boolean not null default false;

-- Seed by rank: Shift Leads, then Specialists, then Agents; alphabetical within
-- each. Steps of 10 leave room to slot someone between two rows later without
-- renumbering everything.
--
-- NOTE: this rewrites every row, so it resets any hand-dragged order. Re-run it
-- only when you want the ranking back; day to day, use "Sort by rank" or the
-- drag handles in the Agents tab.
with ranked as (
  select
    id,
    (row_number() over (
      order by is_lead desc, is_specialist desc, name
    )) * 10 as rn
  from public.agents
)
update public.agents a
set sort_order = r.rn
from ranked r
where a.id = r.id;

select
  name,
  case when is_lead then 'Shift Lead'
       when is_specialist then 'Specialist'
       else 'Agent' end as position,
  sort_order
from public.agents
order by sort_order nulls last, name;

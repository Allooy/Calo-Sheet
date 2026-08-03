-- CX Specialist role. Run once in Supabase → SQL Editor.
--
-- The roster has three job titles, which the schedule sheet shows as the
-- colour of the agent's name cell:
--   CX Shift Lead  salmon  (is_lead = true)
--   CX Specialist  blue    (is_specialist = true)
--   CX Agent       grey    (neither)

alter table public.agents
  add column if not exists is_specialist boolean not null default false;

-- Seed from the August 2026 sheet's blue name cells. Matched case-insensitively
-- on trimmed names so trailing spaces in the roster don't cause a miss.
update public.agents set is_specialist = true
where lower(trim(name)) in (
  'osama al-musaifer',
  'reham alqassab',
  'alia alisa',
  'fatima alali',
  'sharifa butti',
  'fahad alderzi',
  'nora al-ahaimer',
  'reem alraddia',
  'ali jalal'
);

-- Check: should list 9 specialists, and no one should be both.
select name, is_lead, is_specialist
from public.agents
where is_specialist or is_lead
order by is_lead desc, is_specialist desc, name;

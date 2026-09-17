-- Sets the Agents tab / sheet row order and saves it as the "Main order" template.
-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- The 26 names below come first, in this order. Everyone else (shift leads,
-- fixed-pattern people, inactive agents) follows, leads first, keeping their
-- current relative order.

-- 1) Preview: any name below that does NOT match an agent shows up here.
--    If this returns rows, fix the spelling before running step 2.
with wanted(pos, nm) as (values
  (1,  'osama al-musaifer'),
  (2,  'mohammed hussain'),
  (3,  'nawaf khalid'),
  (4,  'mohsen mahmood'),
  (5,  'ali eid'),
  (6,  'hussain a. salman'),
  (7,  'fahad alderzi'),
  (8,  'ebrahim mohamed'),
  (9,  'omar alkooheji'),
  (10, 'abdulla alansari'),
  (11, 'khaled alghurair'),
  (12, 'reham alqassab'),
  (13, 'sharifa butti'),
  (14, 'ali mashkas'),
  (15, 'fatema husain'),
  (16, 'nora'),
  (17, 'alia'),
  (18, 'fatima akhend'),
  (19, 'hassan abdullah'),
  (20, 'fatima alali'),
  (21, 'mariam alshawi'),
  (22, 'hasan alaradi'),
  (23, 'fatema butti'),
  (24, 'mahmood almosawi'),
  (25, 'reem ali'),
  (26, 'hussain ali')
)
select w.pos, w.nm as not_found
from wanted w
left join public.agents a
  on regexp_replace(lower(trim(a.name)), '\s+', ' ', 'g') = w.nm
where a.id is null;

-- 2) Apply the order.
with wanted(pos, nm) as (values
  (1,  'osama al-musaifer'),
  (2,  'mohammed hussain'),
  (3,  'nawaf khalid'),
  (4,  'mohsen mahmood'),
  (5,  'ali eid'),
  (6,  'hussain a. salman'),
  (7,  'fahad alderzi'),
  (8,  'ebrahim mohamed'),
  (9,  'omar alkooheji'),
  (10, 'abdulla alansari'),
  (11, 'khaled alghurair'),
  (12, 'reham alqassab'),
  (13, 'sharifa butti'),
  (14, 'ali mashkas'),
  (15, 'fatema husain'),
  (16, 'nora'),
  (17, 'alia'),
  (18, 'fatima akhend'),
  (19, 'hassan abdullah'),
  (20, 'fatima alali'),
  (21, 'mariam alshawi'),
  (22, 'hasan alaradi'),
  (23, 'fatema butti'),
  (24, 'mahmood almosawi'),
  (25, 'reem ali'),
  (26, 'hussain ali')
),
ranked as (
  select a.id,
         row_number() over (
           order by (w.pos is null), w.pos,
                    a.is_lead desc, a.active desc,
                    a.sort_order nulls last, a.name
         ) as rn
  from public.agents a
  left join wanted w
    on regexp_replace(lower(trim(a.name)), '\s+', ' ', 'g') = w.nm
)
update public.agents a
set sort_order = r.rn * 10
from ranked r
where r.id = a.id;

-- 3) Save it as the "Main order" template (replaces an older one with that name).
insert into public.app_settings (key, value)
values ('cx-order-templates', '[]'::jsonb)
on conflict (key) do nothing;

update public.app_settings
set value = (
      select coalesce(jsonb_agg(t), '[]'::jsonb)
      from jsonb_array_elements(value) t
      where t->>'name' <> 'Main order'
    ) || jsonb_build_array(jsonb_build_object(
      'name', 'Main order',
      'ids', (select jsonb_agg(id order by sort_order) from public.agents),
      'savedAt', now()
    )),
    updated_at = now()
where key = 'cx-order-templates';

-- 4) Check the result.
select sort_order, name, is_lead, active
from public.agents
order by sort_order nulls last, name;

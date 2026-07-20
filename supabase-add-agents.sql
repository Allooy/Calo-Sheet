-- Ensure the full CX roster exists. Adds only agents that aren't already there
-- (matched by name, trimmed). Safe to re-run. Run in Supabase → SQL Editor.

insert into public.agents (name, role, active)
select v.name, 'agent', true
from (values
  ('Jaafar Mohamed'),
  ('Maryam Al-Shaikh'),
  ('Ansari'),
  ('Mishal AlBaiz'),
  ('Maryam Allaith'),
  ('Adel Lari'),
  ('Osama Al-Musaifer'),
  ('Reem Ali'),
  ('Faisal Alhussaini'),
  ('Abdulla AlAnsari'),
  ('Ebrahim Mohamed'),
  ('Reham Alqassab'),
  ('Hassan Alaradi'),
  ('Anwaar Ebrahim'),
  ('Samar Alderazi'),
  ('Fatema Butti'),
  ('Mariam AlShawi'),
  ('Mohammed Hussain'),
  ('Alia Alisa'),
  ('Nawaf Khalid'),
  ('Fatima Alali'),
  ('Sharifa Butti'),
  ('Fahad Alderzi'),
  ('Omar Alkooheji'),
  ('Ali Eid'),
  ('Maryam Nabeel'),
  ('Mohsen Mahmood'),
  ('Hussain A. salman'),
  ('Fatima Akhend'),
  ('Khaled AlGhurair'),
  ('Jawad Alawadhi'),
  ('Hussain Ali'),
  ('Shaikha Ahmed'),
  ('Ali Mashkas'),
  ('Hassan Abdullah'),
  ('Mahmood Almosawi'),
  ('Fatema Husain'),
  ('Reem AlRaddia'),
  ('Ali Jalal')
) as v(name)
where not exists (select 1 from public.agents a where a.name = v.name);

-- Flag the shift leads
update public.agents set is_lead = true
where name in (
  'Ansari','Adel Lari','Jaafar Mohamed','Mishal AlBaiz','Maryam Allaith','Maryam Al-Shaikh'
);

-- Check the roster
select name, role, active, is_lead from public.agents order by name;

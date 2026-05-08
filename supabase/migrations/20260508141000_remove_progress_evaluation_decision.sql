alter table public.evaluations
  alter column decision set default '';

update public.evaluations
set decision = ''
where decision = 'Progress';

alter table public.evaluations
  drop constraint if exists evaluations_decision_check;

alter table public.evaluations
  add constraint evaluations_decision_check
  check (decision in ('', 'Yes', 'No'));

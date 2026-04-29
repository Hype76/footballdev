alter table public.evaluations
  drop constraint if exists evaluations_decision_check;

alter table public.evaluations
  add constraint evaluations_decision_check
  check (decision in ('', 'Yes', 'No', 'Progress'));

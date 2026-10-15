create table account_reminders (
  account_id      uuid not null references accounts(id) on delete cascade,
  kind            text not null check (kind in ('due_soon', 'closing_soon')),
  threshold_days  integer not null check (threshold_days > 0),
  cycle_due_at    timestamptz not null,
  sent_at         timestamptz not null default now(),
  primary key (account_id, kind, threshold_days, cycle_due_at)
);

create index account_reminders_sent_idx on account_reminders (sent_at);

grant select, insert, delete on account_reminders to account_lifecycle;

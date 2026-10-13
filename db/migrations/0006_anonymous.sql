

create or replace function identity.unmask_profile_identity(
  p_blind_index    bytea,
  p_actor          text,
  p_reason_code    text,
  p_reason_detail  text,
  p_case_ref       text default null,
  p_approved_by    text default null
) returns table (
  out_account_id     uuid,
  out_email          text,
  out_status         text,
  out_known_handle   text,
  out_known_name     text
)
language plpgsql
security definer
set search_path = identity, public
as $$
declare
  v_account uuid;
begin
  if p_reason_code <> 'court_order' then
    if p_approved_by is null
       or length(trim(p_approved_by)) = 0
       or lower(trim(p_approved_by)) = lower(trim(p_actor)) then
      raise exception 'a second, different approver is required' using errcode = 'TS001';
    end if;
  end if;

  v_account := identity.unmask_profile(
    p_blind_index, p_actor, p_reason_code, p_reason_detail, p_case_ref, p_approved_by);

  if v_account is null then
    return;
  end if;

  return query
    select a.id, a.email::text, a.status::text, p.handle::text, p.display_name
      from accounts a
      left join identity.known_profile_owner o on o.account_id = a.id
      left join profiles p on p.id = o.profile_id
     where a.id = v_account;
end $$;

revoke all on function identity.unmask_profile_identity(bytea, text, text, text, text, text) from public;
grant execute on function identity.unmask_profile_identity(bytea, text, text, text, text, text)
  to trust_safety;

revoke execute on function identity.unmask_profile(bytea, text, text, text, text, text)
  from trust_safety;

grant update (hidden_at, hidden_reason) on posts, comments to account_lifecycle;

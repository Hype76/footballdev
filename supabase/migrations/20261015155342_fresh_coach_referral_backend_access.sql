-- The backend reservation function reads only the actor identity from this private ledger.
-- Keep all other columns private and retain the existing RLS and client-role revocations.
grant select (user_id) on app_private.deleted_workspace_access to service_role;

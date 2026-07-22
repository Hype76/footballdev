# Security monitoring runbook

Reference: `FP-V1-SECURITY-M3-SUPPLY-GOVERNANCE-ASSURANCE-IMPLEMENT-01`

Finding closed in candidate: `FP-SPR-018`

## Architecture

The existing `public.audit_logs` table remains the single application audit platform. The candidate migration adds event category, severity, outcome, correlation ID, source and a bounded retention deadline. Existing operational inserts receive safe defaults.

New browser audit writes call `record_security_audit_event`. The function derives actor and club from `auth.uid()` and the authoritative `public.users` row. Callers cannot supply actor, tenant, role, name or email. Metadata is recursively redacted for credentials, tokens, session values, contact fields and addresses. Strings, arrays and nesting are bounded.

Authenticated users can no longer insert, update, delete or truncate `audit_logs` directly. Existing scoped select policy remains in force and the application preserves the full operational audit feature gate. Service-role monitoring receives aggregate counts only.

## High-risk event inventory

| Event family | Existing or candidate source | Category | Minimum severity and outcome |
| --- | --- | --- | --- |
| Login, password recovery and recovery abuse controls | Supabase Auth logs, password recovery function and audit RPC | `authentication` | `notice/success`, `warning/denied`, `error/failure` |
| User, membership and role authority changes | Authority containment functions and audit RPC | `authority` | `notice/success`, `warning/denied`, `critical/failure` for invariant failure |
| Club owner, staff and parent invitation processing | Invitation processors and database audit inserts | `authority` or `delivery` | `notice/success`, `warning/denied`, `error/failure` |
| Platform club or team administration | Privileged database functions and platform actions | `platform` | `notice/success`, `warning/denied`, `critical/failure` for partial authority mutation |
| Data transfer inspect, confirm, execute and download | Data transfer functions and audit inserts | `data_access` or `data_change` | `notice/success`, `warning/denied`, `error/failure` |
| PDF and protected asset rendering | Netlify function logs and audit RPC | `data_access` | `notice/success`, `warning/denied`, `error/failure` |
| Retention, backup and recovery validation | Scheduled retention, restore drill and release validation | `recovery` | `notice/success`, `warning/partial`, `critical/failure` |
| Scheduled processor authentication | Native scheduler authorization and platform logs | `security` | `warning/denied`, `error/failure` |

Expected authorization denial is `denied`. A dependency, database or code failure is `failure`. Do not convert expected denial into a runtime error count.

## Read-only scheduled monitor

`security-audit-monitor` runs every 15 minutes. It requires the protected native Netlify schedule marker and exact schedule payload. It calls only the stable `security_audit_monitor_summary` RPC. It does not insert, update, delete, send email, push, SMS or call an external notification service.

The safe log contains only the time window, aggregate counts, threshold names, status and latest event timestamp. It never includes actor, club, entity, metadata or credential fields. Repeated runs over unchanged data are idempotent.

Thresholds:

- 1 Critical event
- 5 Error events
- 20 denied events
- 5 authority failures
- 10 authentication failures

An exceeded threshold produces a warning-level Netlify log with status `alert`. A monitor dependency failure produces a fixed safe error event. Configure the provider log alert or drain only in the approved release task.

## Triage

1. Confirm the alert is from `security_audit_monitor_summary` and record the correlation window.
2. Compare expected denial and runtime failure counts.
3. Review restricted audit rows only through an authorized administrator account or approved read-only SQL aggregate.
4. Check Netlify function, Supabase Auth, Postgres and Storage logs for the same window.
5. Do not copy metadata, tokens, email addresses or backup data into tickets or the Activity Log.
6. If authority integrity, secret exposure or cross-tenant access is plausible, stop release and begin containment.
7. Record the decision, evidence references and next action in the shared Activity Log.

## Retention

Audit rows default to 400 days and the database constrains each row to 30 through 730 days. The service-role prune function deletes only expired rows, orders deterministically, locks safely and caps each run at 5,000 rows. The existing daily retention function invokes it only when `SECURITY_AUDIT_RETENTION_ENABLED=true`.

Enable that variable only after the migration is applied and the first production count and backup checks pass. Retention deletion has no communication side effect. Update and early deletion remain denied.

## Validation

Run `npm run security:monitoring`. Coverage includes event creation, server-derived actor and tenant, recursive redaction, direct mutation denial, restricted monitoring, threshold evaluation, scheduler authentication, idempotency, retention bounds and absence of communication or business mutation paths.

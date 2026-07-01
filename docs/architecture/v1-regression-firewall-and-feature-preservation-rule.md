# V1 Regression Firewall and Feature Preservation Rule

V1 must not remove approved live behaviour unless Steve explicitly asks.

Any prompt touching navigation, calendar, feedback forms, parent invites, Match Day, email, auth, role access, or deployment must check preservation of approved behaviour before changes are considered complete.

Branch lineage must be checked before deploy. Current production source must be verified before deploy.

Recovery must preserve emergency fixes and newer approved work. An older branch must not be deployed directly to recover a feature.

Missing approved behaviour is a blocker, not a cosmetic issue.

Required preservation checks:

- Feedback Forms and Development Fields must remain separate concepts and visible where role and plan gates allow.
- Team Admin and Manager users must retain form creation, edit, duplicate, archive, and version-safe behaviour.
- Coaches must retain saved form selection when creating development records.
- Parent invites must not send duplicate staff, coach, or manager emails by default.
- Existing active parent portal users must receive a sign-in invite path, not a duplicate registration-only flow.
- Calendar route, navigation, movable quick action, event creation, move or reschedule, cancel fixture, and save changes must remain available.
- Match Day availability emails, availability display, role selection, parent states, and parent portal status labels must remain distinct.
- Platform delete team must stay on the server path with confirmation safeguards.
- Production builds must target the live Supabase ref and must not include the retired staging ref.
- Browser-side destructive production actions must not be introduced.


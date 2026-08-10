# Mobile EAS Test Boundary

Reference: `FP-MOBILE-EAS-TEST-BOUNDARY-REPAIR-07`

Coach and Parent tester builds use only the dedicated Footballplayer.online mobile test environment.

## Supported profile separation

- `development` uses the EAS `development` environment.
- `internal` uses the EAS `preview` environment.
- `store-test` uses the EAS `preview` environment.
- Both remote tester environments contain only the approved test Supabase client configuration and the HTTPS test API configuration.
- The EAS `production` environment is not read or changed in this phase.
- The `store-live` build and submit profiles are absent until a later named production-promotion phase authorises them.

Environment selection is fixed at build time. There is no runtime backend selector. Missing, malformed, live, retired, unknown, insecure, or mismatched resolved values fail closed.

The public client key is verified without logging it. Runtime validation accepts only an anonymous client JWT whose project reference matches the dedicated test Supabase project.

No mobile build, submission, secure-session implementation, Supabase change, Netlify change, or production change is authorised by this decision.

# Security policy

## Supported release

The production `main` release is the supported web release. Mobile release work remains blocked and is not covered by this policy until an approved store release exists.

## Reporting a vulnerability

Use a private GitHub Security Advisory for `Hype76/footballdev`. Do not open a public issue with exploit details, credentials, personal data or recovery material.

Include the affected commit, affected surface, safe reproduction conditions and likely impact. Do not test against real accounts, send communications, change production data or attempt persistence.

## Response handling

The repository owner triages reports, assigns severity and records the decision in the shared Jeluma Labs Activity Log when the report produces meaningful activity. Critical and High findings block release until fixed or explicitly contained. Secrets are rotated only through an approved provider recovery process.

## Release security baseline

Security-sensitive changes require the source-controlled Security gate, an independently reviewed migration when applicable, a Git-built non-production result and a Deploy Preview when runtime behavior changes. Production provider settings are changed only in a separately approved release task.

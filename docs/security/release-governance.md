# Release governance and provider configuration plan

Reference: `FP-V1-SECURITY-M3-SUPPLY-GOVERNANCE-ASSURANCE-IMPLEMENT-01`

Finding closed in candidate: `FP-SPR-017`

## Read-only provider baseline

GitHub repository: `Hype76/footballdev`, public, default branch `main`.

Current live GitHub state before this candidate:

- No repository ruleset is active.
- Force pushes and branch deletion are disabled by the existing branch endpoint.
- Pull requests are not required, required approvals are 0 and CODEOWNER review is not required.
- No required status check is configured.
- Administrator enforcement and conversation resolution are disabled.
- GitHub Actions are enabled for all actions. Default workflow token permission is read and workflows cannot approve pull requests.
- The GitHub Dependency graph is disabled, so the native dependency-review action cannot run until that provider setting is enabled.
- No repository Actions secret or variable name is configured.
- No repository environment, webhook or deploy key is configured.
- The only verified direct collaborator is `Hype76` with administrator access.

Current live Netlify state before this candidate:

- Site `footballplayer-online`, site ID `264c7a36-8b0d-4a35-bedd-9d18482aaf69`.
- Production branch and allowed branch are `main`.
- Repository provider is GitHub and untrusted contributions use review flow.
- Deploy Previews are enabled and payment behavior is disabled in preview and branch contexts by `netlify.toml`.
- Manual or API production deploys are not currently prevented.
- Deploy retention is 90 days.
- Production is built with Node 22 and `npm run build:live` from source configuration.

No live setting was changed by this implementation.

## Source-controlled governance

- `.github/CODEOWNERS` routes all changes and explicitly sensitive paths to the verified owner.
- `.github/pull_request_template.md` requires scope, security, migration, rollback, provider and validation evidence.
- `.github/workflows/security-gate.yml` uses read-only default permissions, exact commit-pinned official actions and no production secret reference.
- `SECURITY.md` defines private reporting and the release security baseline.

Required checks prepared by the workflow:

1. `Security gate / Supply chain`
2. `Security gate / Migration safety`
3. `Security gate / Security and V1 regression`
4. `Security gate / Production build`
5. `Security gate / Functions build`
6. `Security gate / Scope ownership`
7. `Security gate / Dependency review` for pull requests

The checks cover clean installation, supply policy, secret scanning, dependency review, migration history and one-migration allowlist, existing security suites, V1 regression, production build, environment verification, function bundling, CSP and PWA behavior through existing tests, CODEOWNERS and artifact identity.

Untrusted pull requests receive no production secret. Workflow permissions are read-only except the dependency review job's explicit pull request read access. If GitHub-native dependency review is unavailable, the job must pass the repository fallback covering the complete candidate graph, package sources, lifecycle scripts, prohibited licences and Critical or High advisories.

## Live provider application plan

Apply only in the separately approved release and closure task.

1. Add and verify a second eligible human reviewer before requiring an approval.
2. Enable the GitHub Dependency graph and confirm the native dependency-review action succeeds.
3. Create a `main` ruleset that requires a pull request and the seven checks listed above.
4. Keep required approvals at 0 until the second reviewer is verified. Then require 1 non-author approval and CODEOWNER review.
5. Require conversation resolution and block force pushes and deletion.
6. Apply administrator enforcement. Limit bypass to a documented emergency actor or team after a second eligible human exists.
7. Retain read-only default Actions permission. Restrict allowed actions to GitHub-owned actions or an exact allowlist after confirming the Netlify integration requirements.
8. Keep production branch `main`, Deploy Previews enabled and untrusted deploys in review flow.
9. Enable Netlify prevention of non-Git production deploys after confirming the approved emergency rollback route.
10. Require the production deploy commit to equal the reviewed and checked Git commit. Record deploy ID, commit and site ID in the Activity Log.

Steve decision required: identify and authorize the second eligible reviewer and approve the final emergency bypass actor or team.

## Break-glass procedure

Break glass is for active production incidents only. Record the incident owner and reason, use the minimum temporary bypass, preserve the source commit and deploy evidence, run the required checks immediately after containment and remove the bypass. Any unreviewed emergency change must be followed by a reviewed reconciliation pull request. Never use break glass to avoid a failing security check.

## Release order

1. Verify production database backup and provider state.
2. Apply the single approved migration.
3. Validate audit grants, functions, counts and monitoring summary.
4. Apply approved GitHub and Netlify provider controls.
5. Merge the exact checked commit.
6. Deploy the exact matching commit from Git.
7. Verify production, logs, browser smoke and artifact identity.
8. Append one Activity Log release and closure row.

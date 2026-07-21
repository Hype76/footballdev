## Scope

- [ ] The change is limited to the stated objective.
- [ ] Production data, credentials, provider settings and account state were not changed by validation.
- [ ] Any migration is forward-only, independently reviewed and listed below.

## Security and privacy

- [ ] No secret, token, personal data export or private backup is included.
- [ ] Server and database authorization remain authoritative.
- [ ] Expected denials are distinguished from runtime failures.
- [ ] New dependencies, remote imports and install scripts are justified.

## Validation

- [ ] Required Security gate checks pass from this exact commit.
- [ ] A Deploy Preview was checked when runtime behavior changed.
- [ ] Desktop and mobile behavior were checked when UI behavior changed.
- [ ] Failing, skipped and unavailable checks are reported honestly.

Migration files:

`None`

Rollback or roll-forward plan:

`Describe the safe recovery path.`

Provider changes required after merge:

`None`

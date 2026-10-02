# Draft website contact endpoint

Endpoint: `POST https://footballplayer.online/.netlify/functions/send-contact-request`

The only additional browser origin is `https://football-player-new-website-draft.jasonkeegansl.chatgpt.site`. Existing production origins `https://footballplayer.online` and `https://www.footballplayer.online` and originless callers remain supported. No wildcard, credentials, client-controlled recipient, migration or additional service is introduced. CORS is a browser policy, not authentication.

Send JSON with `Content-Type: application/json` and omit credentials:

```json
{
  "name": "Club Secretary",
  "email": "secretary@example.test",
  "message": "Please contact our club.",
  "phone": "",
  "clubTeam": "Example FC",
  "sourcePath": "/clubs/#contact",
  "website": "",
  "submissionId": "12345678-1234-1234-1234-123456789012"
}
```

For the draft, name, valid email, nonempty message and submissionId are required. Generate submissionId with `crypto.randomUUID()` once per submission. Preserve the ID and complete payload after a timeout or retryable failure, then generate a new ID after success or when changing the payload. The optional `website` honeypot must stay empty and should be hidden from people, autofill, keyboard navigation and assistive technology. No child information is requested.

Limits: body 16 KiB (UTF-8 bytes); name 120, email 254, phone 50, message 5000, clubTeam 160, sourcePath 1024, website 200, submissionId 64 UTF-16 code units. SubmissionId allows 16-64 ASCII letters, digits, hyphen and underscore. Single-line fields reject control characters. Messages preserve newlines and tabs and reject other control characters. All HTML values are escaped. Existing first-party callers may still omit message and submissionId. Additional JSON fields are ignored, including recipient fields.

Success is HTTP 200 with `{ "success": true, "id": "..." }`, meaning the provider accepted the message, not that it reached the inbox. Error responses from the function contain `{ "success": false, "message": "..." }`: 400 invalid input or honeypot, 403 disallowed origin/preflight, 405 wrong method, 413 oversized body, 415 wrong content type, 429 rate limited, and 5xx configuration/provider failure. Keep entered values on failure. Display success only after an OK response with `success === true` and a nonempty ID. Handle non-JSON responses and fetch failures with an honest generic retry message. Netlify may return its own 429 without JSON or CORS headers; that can appear to the browser as a fetch failure.

The immediate guard allows 3 POST attempts per trusted Netlify context IP per 180 seconds per warm instance, with a maximum of 4096 hashed IP entries and expired entry cleanup. All attempts, including invalid requests and retries, count. It returns Retry-After and exposes that header to allowed browser origins. Capacity exhaustion fails closed. Forwarding headers supplied by clients are ignored. This guard resets with cold starts and is not distributed. Netlify's all-plan distributed rule allows 12 requests per domain and IP per 180 seconds, including preflight, and may lag up to ten seconds. Neither is an absolute global email-volume cap or a full bot challenge.

The existing shared Resend provider receives a SHA-256 idempotency key derived from normalized content, submissionId and the server-owned recipient. Resend retains keys for 24 hours. Identical legacy submissions without an ID deduplicate within that provider retention period. Retry the exact payload and ID; changing either creates a distinct key. No automatic extra send is added.

Production metadata verified on 02-10-2026: Netlify site `264c7a36-8b0d-4a35-bedd-9d18482aaf69` serves `footballplayer.online`; site and account shared contact-recipient overrides are absent, so `support@jelumalabs.com` is effective. The production Resend key is present with function scope. Sender overrides are absent. Only key presence, context/scope and recipient-match booleans were printed.

Before release, obtain all required security and zero-regression CI results without weakening existing gates. Merge/deploy and actual email tests are outside this delegated authorization. After authorized release, inspect Netlify post-processing logs for the accepted rate-limit rule (invalid rules do not necessarily fail a deploy), verify the exact draft-origin preflight, and coordinate one synthetic contact submission and support inbox verification with the parent. Do not spam-test production email delivery. The parent owns the Sites form, Slack and ActivityLog updates.

References: [Netlify rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/) and [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

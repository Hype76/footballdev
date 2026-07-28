const APPROVED_INTERNAL_SMOKE_RECIPIENTS = new Set([
  'support@jelumalabs.com',
  'steve@jelumalabs.com',
])

export function isApprovedInternalSmokeRecipient(value) {
  return APPROVED_INTERNAL_SMOKE_RECIPIENTS.has(String(value ?? '').trim().toLowerCase())
}

export function getApprovedInternalSmokeRecipientCount() {
  return APPROVED_INTERNAL_SMOKE_RECIPIENTS.size
}

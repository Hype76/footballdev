export function createInitialClubSettingsFormData() {
  return {
    name: '',
    logoUrl: '',
    contactEmail: '',
    contactPhone: '',
  }
}

export function getFallbackClubSettingsFormData(user) {
  return {
    name: String(user?.clubName ?? '').trim(),
    logoUrl: String(user?.clubLogoUrl ?? '').trim(),
    contactEmail: String(user?.clubContactEmail ?? '').trim(),
    contactPhone: String(user?.clubContactPhone ?? '').trim(),
  }
}

export function mapClubToSettingsFormData(club) {
  return {
    name: club.name,
    logoUrl: club.logoUrl,
    contactEmail: club.contactEmail,
    contactPhone: club.contactPhone,
  }
}

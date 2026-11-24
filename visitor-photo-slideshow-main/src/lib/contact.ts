/**
 * Normalizes contact information:
 * - Trims and lowercases if it's an email (contains '@')
 * - Strips all non-digit characters if it's a phone number
 */
export function normalizeContact(contact: string): string {
  const trimmed = contact.trim();
  if (trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }
  // Remove non-digit characters for phone numbers
  return trimmed.replace(/\D/g, "");
}


export const ADMIN_EMAILS = new Set(['matt@soberhelpline.com']);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.trim().toLowerCase());
}

// Shared admin identity for Edge Functions. Keep in sync with
// src/lib/admin.ts and public.admin_email_list() in the database
// (supabase/migrations/20260724100000_multi_admin_support.sql).

export const ADMIN_EMAILS = new Set([
  'matt@soberhelpline.com',
  'matt@freedominterventions.com',
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.trim().toLowerCase());
}

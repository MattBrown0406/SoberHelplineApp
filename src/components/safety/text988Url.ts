/**
 * sms: link for the 988 Lifeline. Spanish speakers reach the Spanish text
 * service by texting AYUDA, so the body is prefilled when the app is in
 * Spanish (iOS and Android spell the query differently).
 */
export function text988Url(language: string | undefined, os: string): string {
  if (!language?.startsWith('es')) return 'sms:988';
  return os === 'ios' ? 'sms:988&body=AYUDA' : 'sms:988?body=AYUDA';
}

// Password reset emails, sent by request-password-reset through Resend from
// the soberhelpline.com domain. The member types the code into the app; there
// is no link to open, so no deep-link or web page is involved.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeResetEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const COPY = {
  en: {
    subject: 'Your Sober Helpline password reset code',
    heading: 'Reset your password',
    intro: 'Enter this code in the Sober Helpline app to choose a new password:',
    expiry: 'The code expires in 1 hour and can be used once.',
    ignore: "If you didn't ask to reset your password, you can ignore this email — your password won't change.",
    signoff: 'With you, Sober Helpline',
  },
  es: {
    subject: 'Tu código para restablecer la contraseña de Sober Helpline',
    heading: 'Restablece tu contraseña',
    intro: 'Escribe este código en la app Sober Helpline para elegir una nueva contraseña:',
    expiry: 'El código vence en 1 hora y solo se puede usar una vez.',
    ignore: 'Si no pediste restablecer tu contraseña, puedes ignorar este correo — tu contraseña no cambiará.',
    signoff: 'Contigo, Sober Helpline',
  },
} as const;

export function buildResetEmail(lang: 'en' | 'es', code: string): { subject: string; html: string; text: string } {
  const c = COPY[lang];
  const safeCode = escapeHtml(code);
  const html = `<!doctype html><html><body style="margin:0;background:#F7F2E8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#173B3F">
<div style="max-width:480px;margin:0 auto;padding:32px 24px">
<h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(c.heading)}</h1>
<p style="font-size:16px;line-height:24px;margin:0 0 16px">${escapeHtml(c.intro)}</p>
<p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 16px;color:#146C73">${safeCode}</p>
<p style="font-size:14px;line-height:21px;color:#52676A;margin:0 0 12px">${escapeHtml(c.expiry)}</p>
<p style="font-size:14px;line-height:21px;color:#52676A;margin:0 0 24px">${escapeHtml(c.ignore)}</p>
<p style="font-size:14px;color:#52676A;margin:0">${escapeHtml(c.signoff)}</p>
</div></body></html>`;
  const text = `${c.heading}\n\n${c.intro}\n\n${code}\n\n${c.expiry}\n${c.ignore}\n\n${c.signoff}`;
  return { subject: c.subject, html, text };
}

# Consent Architecture — Sober Helpline
**Product + legal spec · DRAFT v1 — pairs with Privacy Policy; Claude Code implements the screens, counsel blesses the language**

Consent in this app is not one checkbox at signup. It's a set of explicit, separable moments — each recorded with timestamp and version.

## Consent moments

| # | Moment | When | Default | Revocable? |
|---|---|---|---|---|
| 1 | Terms + Privacy acceptance | Signup | Required | n/a |
| 2 | **Share check-ins/tracker with coach** | Onboarding (attached) or first coach interaction (direct) | OFF until granted | Yes — Settings, immediate |
| 3 | Join provider org (attach account) | Org invite redemption | Explicit screen showing exactly what the org sees | Yes — detach; org loses access |
| 4 | Family Space data sharing | Joining/creating a space | Shows the walls-only rule | Yes — leave space |
| 5 | Share a specific letter with coach | Per letter | OFF | Yes — unshare |
| 6 | Wavering broadcast to family | Per tap | OFF (asked in the moment) | Per event |
| 7 | Crisis emergency contact consent | Onboarding | Disclosed in ToS §6 (not optional — safety floor) | n/a |
| 8 | Push notifications | Onboarding, after value shown | OS-level | Yes |
| 9 | Provider referral (direct accounts) | When requesting consultation | Explicit per request | Per request |

## Screen requirements

- Each consent screen states: what is shared, with whom, why it helps, and how to undo it — in ≤60 words, 6th-grade reading level, both languages.
- No bundling: #2 cannot be folded into #1. App functions (minus coach visibility) if #2 is declined.
- Consent ledger: `consents` table (account_id, consent_key, version, granted_at, revoked_at). The settings screen renders from this table — what you see is what's true.
- Revocation propagates within minutes (RLS policy checks the ledger, not a cached flag).

## Copy drafts (consent #2, the big one)

> **Share your check-ins with your coach?**
> Your daily check-ins and tracker entries help [Maria] see patterns and reach out when it matters. Only your assigned coach sees them — never your family, never your provider's admin staff. You can turn this off anytime in Settings.
> [Share with my coach] [Not now]

> **¿Compartir tus registros con tu coach?**
> Tus registros diarios ayudan a [Maria] a ver patrones y acompañarte cuando importa. Solo tu coach asignado los ve — nunca tu familia, nunca el personal administrativo. Puedes desactivarlo cuando quieras en Configuración.
> [Compartir con mi coach] [Ahora no]

import { supabase } from './supabase';
import { captureAppError } from './monitoring';
import { SIGN_UP_CONFIRM_REDIRECT_URL, confirmationResendOutcome, type ConfirmationResendOutcome } from './frontDoor';

/**
 * "Send the confirmation email again", for the confirm step after sign-up and
 * for a sign-in that was refused because the address is not confirmed yet.
 * One request for both, with the redirect address sign-up uses.
 *
 * The server answers the same way whether or not the address is waiting to be
 * confirmed (it does not reveal who has an account), so 'sent' means "asked",
 * and the words on screen say so.
 */

// When each address was last sent an email, for this run of the app only (in
// memory, never stored): the 60-second rest carries from the confirm step to
// the sign-in screen and back.
const lastSentAt = new Map<string, number>();

function addressKey(email: string): string {
  return email.trim().toLowerCase();
}

/** When this address was last sent a confirmation email in this run of the app, or null. */
export function confirmationEmailLastSentAt(email: string): number | null {
  return lastSentAt.get(addressKey(email)) ?? null;
}

/** Sign-up has just sent the first email, or a resend went out (or was told "too soon"). */
export function noteConfirmationEmailSent(email: string, atMs: number = Date.now()): void {
  if (addressKey(email)) lastSentAt.set(addressKey(email), atMs);
}

/** Never throws. The address is only ever sent to the auth server. */
export async function resendSignUpConfirmation(email: string): Promise<ConfirmationResendOutcome> {
  let outcome: ConfirmationResendOutcome = 'failed';
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: SIGN_UP_CONFIRM_REDIRECT_URL },
    });
    outcome = confirmationResendOutcome(error);
  } catch (resendError) {
    captureAppError(resendError);
  }
  // The button rests after a send, and after the server says "too soon".
  if (outcome !== 'failed') noteConfirmationEmailSent(email);
  return outcome;
}

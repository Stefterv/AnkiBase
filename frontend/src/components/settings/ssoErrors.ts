/** What went wrong on the way back from the provider (oidc.py's sso_error codes). */
export const SSO_ERRORS: Record<string, string> = {
  not_linked: 'That account isn’t connected to an AnkiBase user. Sign in with your password and connect it in Settings → Account.',
  taken: 'That account is already connected to another AnkiBase user.',
  denied: 'Sign-in was cancelled.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'The sign-in took too long, try again.',
  state: 'The sign-in couldn’t be verified, try again.',
  login_first: 'Sign in first, then connect your account.',
  provider_unreachable: 'The sign-in provider can’t be reached right now.',
  provider: 'The sign-in provider didn’t accept the sign-in. The server log has the details.',
};

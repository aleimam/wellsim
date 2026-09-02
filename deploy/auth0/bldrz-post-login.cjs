// Auth0 Post Login Action. Configure BLDRZ_CLIENT_ID in Action secrets before
// attaching this Action. Never store company roles in user-editable metadata.
exports.onExecutePostLogin = async (event, api) => {
  const clientId = event.secrets?.BLDRZ_CLIENT_ID;
  if (!clientId) { api.access.deny('Login configuration unavailable'); return; }
  if (event.client.client_id !== clientId) return;
  if (event.user.email_verified !== true) { api.access.deny('Verify your email before signing in'); return; }
  const requested = event.transaction?.acr_values;
  if (Array.isArray(requested) && requested.includes('http://schemas.openid.net/pape/policies/2007/06/multi-factor')) {
    // Enable only approved factors in this dedicated tenant. The app checks
    // the SIGNED amr/auth_time after this deferred challenge has completed.
    api.multifactor.enable('any', { allowRememberBrowser: false });
  }
};

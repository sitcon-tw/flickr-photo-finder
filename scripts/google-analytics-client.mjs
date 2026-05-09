import { google } from "googleapis";

export const analyticsEditScopes = ["https://www.googleapis.com/auth/analytics.edit"];

function maskCredentialPath(path) {
  if (!path) {
    return "";
  }
  const normalized = String(path);
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const basename = parts.at(-1) ?? normalized;
  return parts.length > 1 ? `.../${basename}` : basename;
}

export async function createAnalyticsAdminService({ scopes = analyticsEditScopes } = {}) {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  if (!credentialPath) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS is not set. Set it in the process environment to a Google service account credential with GA4 property access. See docs/ga4-operations.md.",
    );
  }

  console.error(`Google Analytics auth: using GOOGLE_APPLICATION_CREDENTIALS (${maskCredentialPath(credentialPath)}).`);

  const auth = new google.auth.GoogleAuth({ scopes });
  const authClient = await auth.getClient();
  return google.analyticsadmin({ version: "v1beta", auth: authClient });
}

export function explainGoogleAnalyticsError(error) {
  const message = error?.message ?? String(error);
  const status = error?.code ? `HTTP ${error.code}: ` : "";
  const base = `${status}${message}`;

  if (/insufficient authentication scopes/i.test(message)) {
    return `${base}\n\nThe credential from GOOGLE_APPLICATION_CREDENTIALS does not include the required Google Analytics scope: ${analyticsEditScopes[0]}. Use the service account documented in docs/ga4-operations.md.`;
  }

  if (/permission|forbidden/i.test(message) || error?.code === 403) {
    return `${base}\n\nThe credential from GOOGLE_APPLICATION_CREDENTIALS was accepted but does not appear to have Editor access to the GA4 property, or the Google Analytics Admin API is not enabled. Confirm the service account is listed in GA4 Property Access Management and see docs/ga4-operations.md.`;
  }

  return base;
}

# quickboom-crm-backend

### Google Business Growth connection test

The integration settings test checks Google Ads and Google Business Profile API access with read-only account-list requests. Enter a Google OAuth refresh token in Admin → Settings → Integrations → Google Business Growth. The token must be issued for the configured OAuth client and authorized for both `https://www.googleapis.com/auth/adwords` and `https://www.googleapis.com/auth/business.manage`. It is stored using the integration settings secret encryption and masked when displayed. Configure the OAuth client ID, client secret, and Ads developer token in integration settings or their existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ADS_DEVELOPER_TOKEN` backend environment variables. Enable and obtain access to both Google APIs in the Google Cloud project. Never commit the refresh token or place it in frontend configuration.

A successful test verifies API access only; the Business Growth OAuth connection and synchronization features are still unavailable. No OAuth consent flow is provided by this test, so an administrator must obtain and authorize the refresh token separately. Keep the existing encryption keys stable and do not replace them when deploying this change.

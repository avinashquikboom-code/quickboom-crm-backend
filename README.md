# quickboom-crm-backend

### Google Business Growth connection test

The integration settings test checks Google Ads and Google Business Profile API access with read-only account-list requests. Configure `GOOGLE_BUSINESS_GROWTH_REFRESH_TOKEN` as a backend deployment secret using a refresh token issued for the configured OAuth client and authorized for both `https://www.googleapis.com/auth/adwords` and `https://www.googleapis.com/auth/business.manage`. Configure the OAuth client ID, client secret, and Ads developer token in integration settings or their existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ADS_DEVELOPER_TOKEN` backend environment variables. Enable and obtain access to both Google APIs in the Google Cloud project. Never commit the refresh token or place it in the browser configuration.

A successful test verifies API access only; the Business Growth OAuth connection and synchronization features are still unavailable. No OAuth consent flow is provided by this test, so an administrator must obtain and authorize the refresh token separately. Keep the existing encryption keys stable and do not replace them when deploying this change.

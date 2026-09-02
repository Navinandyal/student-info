This project uses Google OAuth 2.0 for a normal personal Google Drive.

DO NOT place a service-account JSON file here.

After you log in to the app and open:
  http://localhost:3000/auth/google

the Google consent flow will run once. The backend will then create:
  credentials/google-token.json

That token file contains private OAuth credentials and must never be committed,
shared publicly, or exposed to the frontend.

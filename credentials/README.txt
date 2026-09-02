Do not put production Google credentials in this folder when deploying to Vercel.

The old local version stored credentials/google-token.json here. The Vercel-ready
version reads GOOGLE_REFRESH_TOKEN from environment variables instead.

Never commit google-token.json, service-account.json, .env, client secrets, or
refresh tokens to GitHub.

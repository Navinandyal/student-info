# Student Information App — Personal Google Drive + Vercel

Simple Node.js + Express student-information application.

## Current flow

Login -> Add/View Students -> Select multiple photos -> Save -> Google Sheet + Personal Google Drive

There is **no Google login/authorization redirect after admin login**. Google access is configured once on the backend using a refresh token.

## Storage

- Student records: Google Sheet (`GOOGLE_SHEET_ID`)
- Photos: your normal personal Google My Drive
- Photo folders: `Student Photos/<STUDENT_ID>_<STUDENT_NAME>/`

Google Sheets is used for persistent student records because Vercel's local function filesystem is not a persistent SQLite database.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env`.
3. Fill in the environment variables.
4. `npm start`
5. Open `http://localhost:3000`.

For Vercel, add every variable from `.env` in Project Settings > Environment
Variables. In particular, `SESSION_SECRET` must be set for the **Production**
environment. Generate a value with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not use the placeholder value or commit `.env` to GitHub. Redeploy after
changing Vercel environment variables.

## Reuse the Google account you already authorized

Your older project contains `credentials/google-token.json`. Its `refresh_token`
is what this version needs in `GOOGLE_REFRESH_TOKEN`.

From the **old project folder** you can inspect that JSON or run the included
migration helper after copying it temporarily into this project:

```bash
npm run show:refresh-token
```

Then add the value to `.env` and to Vercel Environment Variables. Delete the token
file afterward. Never commit it.

## Required environment variables on Vercel

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `STUDENT_USERNAME`
- `STUDENT_PASSWORD`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_SHEET_ID`
- `GOOGLE_DRIVE_PARENT_FOLDER_ID` (optional)

You do not need `GOOGLE_DRIVE_SHARED_DRIVE_ID` and you do not need a service account.

## Deploy to Vercel from GitHub

1. Push this project to GitHub.
2. Open Vercel and import the GitHub repository.
3. Add all required Environment Variables in Project Settings.
4. Deploy. Vercel detects the exported Express app from `server.js`.
5. Open the deployed URL and log in with your admin username/password.

The admin account can add, view, edit, and delete student records. The separate
student account can add student details and upload photos, but cannot view or
edit existing records.

No Google login page should appear during normal admin usage.

## Photo uploads on Vercel

Vercel Functions have a 4.5 MB request payload limit. The UI keeps the multi-photo
selection experience but optimizes photos in the browser and uploads them one by one.
This prevents a group of photos from exceeding a single function request limit.

## Security

- Admin auth uses an HTTP-only signed cookie; there is no server-memory session dependency.
- Google client secret and refresh token are backend environment variables only.
- `.env`, OAuth token files and service-account files are excluded from Git/Vercel uploads.
- Never expose `GOOGLE_REFRESH_TOKEN` in frontend JavaScript.

## Google OAuth note

The refresh token must have access to the APIs/scopes used by this app. Your current
project already requested Drive + Sheets access, so you can reuse its existing refresh token.

# Student Information App — Personal Google Drive OAuth

Simple Node.js + Express + SQLite student information application.

## Flow

Login -> Student form -> Select multiple photos -> Save Student -> SQLite + personal Google My Drive

Google Drive structure:

```text
My Drive/
└── Student Photos/
    └── STU001_Rahul_Patil/
        ├── photo1.jpg
        ├── photo2.jpg
        └── photo3.jpg
```

## 1. Install

```bash
npm install
```

Copy `.env.example` to `.env`.

## 2. Google Cloud setup

1. Open Google Cloud Console.
2. Create/select a project.
3. Enable **Google Drive API**.
4. Open **Google Auth Platform / OAuth consent screen**.
5. Configure the app. If it is in Testing mode, add your Gmail address as a test user.
6. Open **APIs & Services > Credentials**.
7. Create **OAuth client ID**.
8. Application type: **Web application**.
9. Add this Authorized redirect URI exactly:

```text
http://localhost:3000/auth/google/callback
```

10. Copy the Client ID and Client Secret into `.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

Leave `GOOGLE_DRIVE_PARENT_FOLDER_ID` blank if you want `Student Photos` in the My Drive root.

## 3. Start

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Login using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`.

## 4. Connect your Google Drive once

While logged in, open:

```text
http://localhost:3000/auth/google
```

Choose the Gmail account whose My Drive should receive the student photos and approve access.

After approval, the backend saves the OAuth token privately at:

```text
credentials/google-token.json
```

Do not upload this file to GitHub or expose it to the browser.

Google returns short-lived access tokens; the stored refresh token lets the Node.js backend obtain new access tokens automatically without asking you to log in to Google every time.

## 5. Save students

Return to `/student`, fill the form, choose photos, and click **Save Student**.

The student fields are saved to SQLite and photos are uploaded to your own My Drive.

## Notes

- This version does not use a service account.
- `GOOGLE_DRIVE_SHARED_DRIVE_ID` is not needed.
- `service-account.json` is not needed.
- For local development, the OAuth token is stored in a backend-only file.
- In production, use a persistent encrypted secret/token store instead of an ephemeral filesystem.

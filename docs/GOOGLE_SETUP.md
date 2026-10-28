# Connect Google Classroom (one-time setup, free)

Yaxha reads your Classroom through Google's official sign-in. You never type your Google password into Yaxha; Google shows its own consent screen, and you can remove access any time at https://myaccount.google.com/permissions.

You need a Google account that can sign in to Google Cloud. A school account sometimes cannot create Cloud projects; if so, create the project with a personal Gmail account and add your school account as a test user (step 3).

## 1. Create a project and turn on the APIs

1. Open https://console.cloud.google.com and sign in.
2. Top bar: project picker > **New project**. Name it `Yaxha Academics` > **Create**, then select it.
3. Open **APIs & Services > Library**. Search for and **Enable** each of:
   - **Google Classroom API**
   - **Google Drive API** (needed to read attached files)

## 2. Configure the consent screen

1. **APIs & Services > OAuth consent screen** (on newer consoles: **Google Auth Platform > Branding**).
2. App name `Yaxha Academics`, your email as support and developer contact. Save.
3. **Audience**: choose **External**, and leave the publishing status as **Testing**.
4. **Data access / Scopes**: add these (search by name):
   - `.../auth/classroom.courses.readonly`
   - `.../auth/classroom.topics.readonly`
   - `.../auth/classroom.coursework.me.readonly`
   - `.../auth/classroom.courseworkmaterials.readonly`
   - `.../auth/classroom.announcements.readonly`
   - `.../auth/classroom.rosters.readonly`
   - `.../auth/drive.readonly`
   - `openid`, `email`

## 3. Add yourself as a test user

**Audience > Test users > Add users**: add the Google account you use for Classroom (for example your school account). Only test users can connect while the app is in Testing mode, which is what you want for a personal app.

> In Testing mode Google may ask you to sign in again about once a week. Yaxha will show "Authorization required"; press Reconnect. Publishing the app removes this, but the Drive scope then requires Google's verification review.

## 4. Create the OAuth client

1. **APIs & Services > Credentials > Create credentials > OAuth client ID** (or **Google Auth Platform > Clients > Create client**).
2. Application type **Web application**, name `Yaxha web`.
3. **Authorized redirect URIs > Add URI**:
   - Local: `http://localhost:3000/api/google/callback`
   - Online: `https://YOUR-APP.vercel.app/api/google/callback` (add this later, after deploying)
   The URI must match `APP_URL` + `/api/google/callback` exactly, with no trailing slash.
4. **Create**. Copy the **Client ID** and **Client secret**.

## 5. Give them to Yaxha

In `.env` (or in Vercel's Environment Variables):

```
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=<64 hex characters>
```

Restart the app, open **Google Classroom** in the sidebar and press **Connect Google Classroom**. This also asks for Drive access so summaries and quizzes can use your attached lesson files (choose "Connect without Drive files" if you prefer not to).

## What the statuses mean

| Status | Meaning |
|---|---|
| Not connected | No Google sign-in yet. |
| Connected | Google confirmed access; nothing imported yet. |
| Synchronizing | An import is running. |
| Synchronized | The last import finished without problems. |
| Partially imported | Most things imported; some items or files were not accessible. Each one is listed. |
| Permission required | Some access was not granted (often Drive). Reconnect and allow everything Google asks about. |
| Authorization required | Google sign-in expired or was revoked. Reconnect. |
| Synchronization failed | The import could not run; the error is shown. |

Files your account cannot open (teacher-restricted, deleted, or shared only with others) are marked **Permission required** with a link to open them in Google. Yaxha never tries to get around those restrictions.

## Troubleshooting

- **"redirect_uri_mismatch"**: the URI in step 4 is not exactly `APP_URL/api/google/callback`. Check http vs https and trailing slashes.
- **"Access blocked: app has not completed verification"**: your account is not in the test users list (step 3).
- **No courses imported**: check that the Classroom account you signed in with is the one enrolled in the classes.
- **Files show "not read"**: Drive access was not granted. Reconnect and allow Drive.

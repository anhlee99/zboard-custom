# ZBoard

Self-hosted Milanote-style canvas. See the build plan; work is done step by step.

## Google Drive backup (one-time setup)

ZBoard backs up to your own Google Drive with your own Google Cloud project, so no third party sees the data.
It only uses the `drive.file` scope: it can see the files it created (the `ZBoard Backup` folder) and nothing else.

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "ZBoard").
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: User type **External**, fill in the app name and your email.
   Add the scope `.../auth/drive.file`. Add yourself as a test user.
4. **Publish the app** (OAuth consent screen → *Publishing status* → **In production**).
   While it is in *Testing*, Google expires the sign-in after 7 days and backups stop.
   An unverified app in production is fine for personal use: Google shows a warning screen once when you connect.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**, application type
   **TVs and Limited Input devices**. Copy the client ID and secret.
6. Put them in `.env` and restart ZBoard:

   ```
   GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   # optional: encrypt everything before upload (keep this safe, it is needed to restore)
   GOOGLE_BACKUP_PASSPHRASE=
   ```

7. In ZBoard open **Menu → Google Drive → Connect Google Drive**. Open the address shown
   (google.com/device) on any device, enter the code and approve.

What happens then:

- Each original image is uploaded once into `ZBoard Backup/files/`.
- A database snapshot is uploaded to `ZBoard Backup/snapshots/` 1–2 minutes after edits stop, and nightly
  (with the local backup, `BACKUP_CRON`). The last 30 snapshots are kept.
- **Restore** (Menu → Google Drive → Restore) downloads the newest snapshot and every original it needs and
  replaces this server's data. To move to a new machine: start ZBoard with an empty `data/`, connect the same
  Google account, press Restore. An empty server never uploads a snapshot by itself, so it can't overwrite your backup.

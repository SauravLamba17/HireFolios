# Installing Hirefolios on the office PC (Windows)

This guide is for the person who looks after the office computers. You do not need to be a
developer. Follow the steps in order; each step says how to check it worked.

Hirefolios runs on **one Windows PC** in the office (the **server PC**). Everyone else (HR,
interviewers, managers, the lobby TV) opens it in Chrome or Edge at
**https://simplen.hirefolios.in** on the office network. Nothing is sent to the internet.

On the server PC, three Windows services start by themselves whenever Windows starts:

| Service (in `services.msc`) | What it is |
|---|---|
| `postgresql-x64-16` | The database (all candidate records) |
| `Hirefolios` | The Hirefolios program |
| `Hirefolios HTTPS (Caddy)` | The secure `https://` address (the webcam needs it) |

Nobody needs to start anything by hand.

---

## 0. Check the PC first (before buying extras or installing)

Your developer sends `check-machine.ps1` (it is also in the `scripts` folder of the Hirefolios zip). It needs
no admin rights and changes nothing. On the PC that will be the server, open **PowerShell** (normal, not
administrator) in the folder where the file is and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\check-machine.ps1
```

It checks Windows, memory (8 GB or more), free disk (50 GB or more), SSD, time zone (India), sleep settings,
network (Private, fixed address, cable), ports 80 / 443 / 3000 / 5432, PostgreSQL or Node.js already installed,
antivirus, webcam, and the Chrome / Edge versions. Each line says **PASS**, **WARN** or **FAIL** with what to do.

- **Fix every FAIL** before installing (step 2 covers most of them), then run the check again.
- Read every **WARN**: most are advice (for example "use a cable"), not blockers.
- It saves a report on the Desktop (`hirefolios-machine-check-<PC name>-<date>.txt`): **send that file to your developer.**

Run it on the HR desk PC too: it shows whether the webcam is found and the browser is recent enough.

## 1. What to buy

| Item | Notes |
|---|---|
| **Server PC** (or a mini PC) | Windows 10 or 11, 64-bit. 8 GB memory (16 GB better), **SSD** with 256 GB or more, wired network port. A business mini PC is fine; it only needs to stay on. |
| **UPS** (battery backup), 600-1000 VA | For the server PC **and** the router, so a short power cut does not stop drive day or damage the database. |
| **USB webcam** for the HR desk PC | Any 1080p USB webcam that works in Windows' Camera app. Two webcams on one PC are fine (you pick one in Hirefolios). |
| **USB drive or second disk**, 64 GB or more | A second copy of the nightly backup. Keep it plugged into the server PC, or swap two drives weekly and take one home. |
| Scanner (optional) | Only if you prefer scanning paper CVs to PDF; the webcam can photograph paper CVs too. |
| **TV** for the lobby + a small PC / stick PC / old laptop with Chrome, HDMI cable | Shows token numbers being called. |
| Router | Must let you **reserve an address** for the server PC (almost all can). "Local DNS" is a bonus (step 5). |

## 2. Prepare the server PC

1. Install all Windows updates and restart.
2. **Settings → System → Power:** Sleep **Never** (the screen may turn off).
3. **Settings → Time & language:** time zone **(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi**, set automatically.
4. In the PC's BIOS/UEFI (ask the shop if unsure), set **"Restore on AC power loss: Power On"**, so the
   PC switches itself back on after a power cut.
5. **Fixed address:** in the router's admin page find **DHCP reservation** (also called "Static lease"
   or "Address reservation") and reserve an address for the server PC, for example `192.168.1.20`.
   Restart the PC. Check: in PowerShell, `ipconfig` shows that address as "IPv4 Address".
   This guide calls it **the server address**.

## 3. Copy Hirefolios to the server PC

Your developer gives you a file like `hirefolios-0.1.0.zip` (on a USB stick or by download).

1. Copy it to the server PC, for example to **Downloads**.
2. Right-click the zip → **Properties** → if there is an **Unblock** box at the bottom, tick it → **OK**.
3. Right-click the zip → **Extract All** → **Extract**. You get a folder `hirefolios-0.1.0` with
   `app`, `docs`, `scripts` and `tools` inside.

## 4. Run the installer

1. Click **Start**, type **PowerShell**, right-click **Windows PowerShell** → **Run as administrator** → **Yes**.
2. Go to the extracted folder (change the path if you extracted it somewhere else) and start the installer:

   ```powershell
   cd $HOME\Downloads\hirefolios-0.1.0
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
   ```

3. Answer the questions:

   | Question | Answer |
   |---|---|
   | Server address staff will type | Press **Enter** (simplen.hirefolios.in) |
   | Choose A or B | Press **Enter** for **B** (works without internet). For A see step 7. |
   | Admin email | Your email; you sign in with it |
   | Admin password, twice | 8 characters or more. Nothing shows while you type: that is normal |

4. Wait. The first time takes 5 to 15 minutes (installing PostgreSQL takes most of it). The installer:
   - checks Windows, admin rights, free disk and that ports 80 and 443 are free;
   - installs **PostgreSQL 16** with Windows' own installer (winget), or uses one already installed
     (then it asks for that PostgreSQL's `postgres` password);
   - creates the database and its own database login with a random password;
   - writes the settings file `C:\hirefolios\.env` (random passwords, never shown; only
     Administrators and the Hirefolios service can read it);
   - copies the program to `C:\hirefolios`, photos and CVs go to `C:\hirefolios-data\uploads`;
   - sets up the three services (start with Windows, restart by themselves if they stop);
   - opens ports 80 and 443 in the Windows Firewall, for **private** networks only;
   - schedules the backup at **6:15 pm, Monday to Saturday**;
   - checks that https://simplen.hirefolios.in answers and that your admin account can sign in.
5. At the end it prints a green **"installed and running"** box with:
   - the server address on the network,
   - for option B, the **certificate fingerprint** (16 groups of 4 letters/digits).
     **Write it down or photograph it**; you compare it on every PC in step 6. It is also saved in
     `C:\hirefolios\certificate-fingerprint.txt`.

Check: on the server PC, open Chrome or Edge at **https://simplen.hirefolios.in**. The sign-in page
opens with a padlock and no warning.

If the installer stops with a red message, it says what to do. Fix that and run the **same command
again**: it is safe to re-run, and it keeps everything already done (settings, database, files).

- *"Port 443 is used by ..."*: another program (often IIS, Skype or another web server) holds the port.
  Stop or uninstall it, then run the installer again.
- *"winget could not install PostgreSQL"* or **no internet on the server PC**: on any PC with internet,
  download the **PostgreSQL 16, Windows x86-64** installer from
  https://www.enterprisedb.com/downloads/postgres-postgresql-downloads, copy it to the server PC and run:
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -PostgresInstaller C:\path\to\postgresql-16.x-windows-x64.exe`
  (everything else the installer needs is inside the Hirefolios folder).
- *"Windows treats the network ... as Public"*: answer **Y** if it is your office network, otherwise
  other PCs cannot connect.

## 5. Let every PC find the server

Every office PC must find `simplen.hirefolios.in` at the server address. Use **one** of these:

- **Router (best, one place):** in the router's admin page find **Local DNS**, **Static DNS**,
  **DNS host mapping** or **Hostname mapping** and add `simplen.hirefolios.in` → the server address.
- **Hosts file on each PC:** copy the `scripts` folder to a USB stick. On each PC, open PowerShell
  **as administrator** and run (with your server address):

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File E:\scripts\set-hosts.ps1 -ServerIp 192.168.1.20
  ```

  (The server PC itself is already done by the installer.) To undo: `set-hosts.ps1 -Remove`.

Check, on every PC: `ping simplen.hirefolios.in` shows the server address.

## 6. Trust the server's certificate on each PC (option B)

Only for option B. Do this once on **every** office PC that opens Hirefolios (HR desk, interviewers,
managers, the TV's PC). The server PC is already done.

On each PC, PowerShell **as administrator**, from the USB stick with the `scripts` folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\scripts\trust-certificate.ps1 -Server simplen.hirefolios.in
```

It shows a fingerprint. **Compare it with the one the installer printed.** If they are the same,
type the **last 4 characters**. Close and reopen Chrome / Edge.

Check: https://simplen.hirefolios.in opens with a padlock and no warning.

- No network to the server yet? Copy `C:\hirefolios\hirefolios-root.crt` from the server to the USB stick
  and use `-CertFile E:\hirefolios-root.crt` instead of `-Server ...`.
- Firefox: open `about:config`, set `security.enterprise_roots.enabled` to `true`, restart Firefox.
- The certificate is valid for about 10 years. A new PC later: run the same command on it.

## 7. Option A: Let's Encrypt through Cloudflare (instead of B)

Use this only if Simplen manages `hirefolios.in` in Cloudflare and the server PC has internet.
Then no PC needs step 6. The server PC needs the internet about once every two months (renewal).

1. Cloudflare → **My Profile → API Tokens → Create Token** → template **Edit zone DNS** →
   Zone Resources: **Specific zone → hirefolios.in** → create, copy the token (shown only once).
2. Run the installer (step 4), answer **A**, and paste the token when asked (it is not shown).
3. Step 5 is still needed (the name must point at the server address inside the office).

## 8. First sign-in and staff accounts

1. Open https://simplen.hirefolios.in and sign in with the admin email and password from step 4.
2. **Staff:** add HR, managers, interviewers, and one **display** account for the lobby TV.
   Each person gets a temporary password and must choose their own at first sign-in.
3. On the **Candidates** page the admin sees a **Server status** box: database, free disk, last backup.
4. **Settings** (fill these in before the first drive; anything marked *Sample* is a starting value to confirm):
   - **Company:** company name, short name, token prefix (tokens look like A-001), office address, logo
     (PNG/JPEG/WebP, up to 1 MB; shown in the header, on the TV and in Excel exports). Press **Save** once.
   - **Lists:** certifications, coding specialties, EHR / PM software, education, notice periods, sources,
     languages. Rename, add, reorder, or untick **In use** to retire an item (it disappears from new forms
     but stays on the candidates who have it). Items are never deleted.
   - **Privacy notice:** **Start a new version**, have the English and Hindi text checked (legal adviser, and a
     Hindi speaker), name the **contact person** for data requests and complaints (name + email or phone), then
     **Publish as new version**. Earlier versions stay read-only; each consent keeps the version it was given.
   - **Jobs, rounds & retention:** positions, interview rounds and scorecards, reject reasons, how long data is kept.

## 9. HR desk: webcam test

1. Plug the USB webcam into the HR desk PC. Open https://simplen.hirefolios.in, sign in as HR.
2. **+ New candidate** → type a test mobile → **Find** → fill the details → consent → **Skip CV** →
   on the Photo step the picture must show. Chrome asks once to allow the camera: **Allow**.
3. Two webcams? Pick the right one in the **Webcam** list; that PC remembers it.
4. Cancel the test candidate (or finish it and erase it: **Privacy → Log a request → Erasure**).

HR can **always register a candidate by typing everything by hand**: no step needs a CV, a scanner or
the internet. If the webcam is missing or broken, use **Upload a photo file instead**.

If the photo step says the webcam needs the secure address, the browser is not on `https://`, or step 6
was not done on that PC.

## 10. Lobby TV

On the TV's PC: Chrome → https://simplen.hirefolios.in → sign in with the **display** account →
press **F11** (full screen) → turn the chime on. It stays signed in for 30 days. The TV only shows
token numbers and rooms, never names or photos.

## 11. Daily use

- Keep the server PC **on**. Nothing to start by hand: after a restart or power cut, the three services
  start by themselves within a minute or two (no one needs to sign in to Windows).
- The backup runs at 6:15 pm Monday to Saturday. If the PC was off at that time, it runs as soon as the
  PC is back on. The **Server status** box shows the last backup time.
- Windows updates may restart the PC at night; that is fine.

## 12. Backups

Each backup is a folder in `C:\hirefolios-backups` named by date and time (for example
`2026-11-11_181500`), holding `database.dump` (all records), `uploads.tar.gz` (photos and CVs)
and `manifest.txt` (checksums). `backup.log` lists every run. A backup that was cut off (power
cut) is left as `...partial` and never used; it is cleaned up the next day.

Backups older than 14 days are deleted (the newest 3 are always kept).

**Run one by hand** (PowerShell as administrator):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\backup.ps1
```

**Second copy (strongly recommended):** a backup on the same disk does not survive a dead disk or theft.
Open Notepad **as administrator**, open `C:\hirefolios\.env`, set the line
`BACKUP_COPY_DIR=E:\hirefolios-backups` (your USB drive letter) and save. Every backup is then copied
there too; if the drive is missing, the backup still runs and `backup.log` says the copy failed.
To keep more days, change `BACKUP_KEEP_DAYS=14`. Do not change other lines in that file.

## 13. Restoring a backup

Only when something has gone wrong. Restoring **replaces all current data** with the backup.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\restore.ps1 -From C:\hirefolios-backups\2026-11-11_181500
```

It checks the backup's files, asks you to type `RESTORE`, stops Hirefolios, **backs up the current
state first**, puts the database back in one step (if anything fails, nothing changes), puts the
photos and CVs back, starts Hirefolios and checks it. The old photos folder is kept next to the new one
(`C:\hirefolios-data\uploads.before-restore-...`) until you delete it.

If the current data is too damaged to back up, it says so and asks you to type `CONTINUE` to restore anyway.

**Server PC died?** Set up the new PC with steps 2 to 4 (a new admin account is fine; the restore
brings the old accounts back), copy the backup folder from the USB drive, run the restore. Then repeat
step 6 on every PC (the new server has a new certificate).

## 14. Installing a new version

Your developer gives you a new zip (for example `hirefolios-0.2.0.zip`). Unblock and extract it (step 3),
then in PowerShell as administrator:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\update.ps1 -From $HOME\Downloads\hirefolios-0.2.0
```

It stops Hirefolios (a minute; do it outside drive hours), **backs up first**, puts the new version in
place, starts it (database changes are applied then) and checks it. If the new version does not come up
healthy, it **goes back to the old version by itself** (and puts the database back if it was changed),
says "Update ... FAILED and was rolled back", and keeps the failed version for your developer.

## 15. Uninstalling

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\uninstall.ps1
```

Type `UNINSTALL` to confirm. It removes the services, the backup task, the firewall rule and
`C:\hirefolios`. **Candidate data, the database and backups are kept**, so installing again later
brings everything back. To delete them too, add `-RemoveData` and/or `-RemoveBackups` (each asks you to
type `DELETE`); `-RemoveData -RemovePostgreSQL` also removes PostgreSQL if the installer installed it.
On other PCs: `trust-certificate.ps1 -Remove` and `set-hosts.ps1 -Remove`.

## 16. When something is wrong

| What you see | What to do |
|---|---|
| Page does not open on any PC | Is the server PC on? Open `services.msc`: the three services in the table at the top must say **Running**. Right-click → **Start** if not. |
| Opens on the server PC but not on others | `ping simplen.hirefolios.in` on that PC (step 5). Network must be **Private** on the server PC (Settings → Network → your network → Private). |
| Certificate warning | Option B: step 6 not done on that PC (or the server was reinstalled: do step 6 again). |
| Webcam blocked | The address must start with `https://`. Click the camera icon in the address bar → **Allow**. Or use **Upload a photo file instead**. |
| Server status box shows a problem | Database: is `postgresql-x64-16` running? Disk: free some space. Send `C:\hirefolios\logs` to your developer. |
| Last backup is old | Look at `C:\hirefolios-backups\backup.log`; Task Scheduler → "Hirefolios backup" → Last Run Result. |
| Update says FAILED and rolled back | Nothing to do on drive day: the old version runs. Send `C:\hirefolios\logs\update-*.log` to your developer. |
| Anything else | `https://simplen.hirefolios.in/api/health` shows the status without signing in. Send `C:\hirefolios\logs` to your developer. |

Send logs to your developer, **never** `C:\hirefolios\.env` (it holds the passwords).

## 17. The settings file (`C:\hirefolios\.env`) — reference

The installer writes this file; normally nobody edits it. Only Administrators can open it (Notepad, **Run as
administrator**). After a change, restart the **Hirefolios** service (`services.msc` → right-click → Restart).
If a value is missing or wrong, Hirefolios does not start and its log (`C:\hirefolios\logs\hirefolios.out.log`
or `.err.log`) names the variable, for example `UPLOAD_DIR must be an absolute folder path`.

| Variable | What it is | Default |
|---|---|---|
| `DATABASE_URL` | The database and its login (written by the installer) | required |
| `BETTER_AUTH_URL` | The address staff type, e.g. `https://simplen.hirefolios.in` | required |
| `BETTER_AUTH_SECRET` | Sign-in secret (generated; changing it signs everyone out) | required |
| `UPLOAD_DIR` | Folder for photos, CVs and the logo | required |
| `PORT`, `HOSTNAME` | Where the program listens (Caddy forwards to it) | 3000, 127.0.0.1 |
| `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `BACKUP_COPY_DIR` | Backups folder, days kept, second copy (USB) | `C:\hirefolios-backups`, 14, none |
| `STAFF_SESSION_HOURS` | How long staff stay signed in (1-24) | 12 |
| `DISPLAY_SESSION_DAYS` | How long the lobby TV stays signed in (1-90) | 30 |
| `MAX_UPLOAD_MB`, `MAX_CV_FILES`, `MAX_CV_PAGES` | Intake upload limits | 8, 5, 10 |
| `PURGE_JOB`, `PURGE_INTERVAL_MINUTES` | The deletion job (retention): on/off and how often | on, 30 |
| `OFFICE_HOURS` | The deletion job waits outside these hours, e.g. `09:00-19:00` | any time |
| `RUN_MIGRATIONS`, `MIGRATIONS_DIR`, `SEED_ON_START` | Start-up database set-up (installer) | 1, app folder, 0 |
| `PG_BIN`, `PG_SERVICE`, `PG_SUPERUSER_PASSWORD`, `APP_DOMAIN`, `HTTPS_OPTION`, `CLOUDFLARE_API_TOKEN` | Used by the install / backup / update scripts | written by the installer |

Pinned versions (Node.js 24, PostgreSQL 16, Caddy, WinSW) live in `scripts\versions.json`; Hirefolios refuses to
start on another Node.js or PostgreSQL major version and says which one it needs.

# Installing Hirefolios on the office PC

This guide is for the person who looks after the office computers. You do not need to be a
developer. Follow the steps in order; each one says how to check it worked.

Hirefolios runs on **one office PC** (the "server PC"). Everyone else (HR, interviewers,
managers, the lobby TV) opens it in a browser at **https://simplen.hirefolios.in** on the
office network. Nothing is sent to the internet.

---

## 1. What you need

- A Windows 10 or 11 PC that stays on during office hours: 8 GB memory or more, 50 GB free disk.
  Set **Settings → System → Power → Sleep: Never** (the screen may turn off).
- The Hirefolios folder (from your developer), copied to `C:\hirefolios`.
- Admin rights on that PC.
- For HTTPS option A only: access to the Cloudflare account that holds `hirefolios.in`.

## 2. Give the server PC a fixed address

In your router's admin page, find **DHCP reservation** (sometimes "Static lease" or "Address
reservation") and reserve an address for the server PC, for example `192.168.1.20`.
Restart the PC.

Check: open PowerShell and run `ipconfig`. The "IPv4 Address" shows the reserved address.
The rest of this guide calls it **the server address**.

## 3. Install Docker Desktop

1. Download Docker Desktop for Windows from docker.com and run the installer (keep "Use WSL 2").
2. Restart when asked, open Docker Desktop and accept its terms.
3. In Docker Desktop → **Settings → General**, tick **Start Docker Desktop when you sign in**.

Check: in PowerShell, `docker version` prints a "Server" section without errors.

Docker only runs while a Windows user is signed in on the server PC. After a power cut, switch
the PC on and sign in; Hirefolios starts by itself a minute later.

## 4. Make the folders

In PowerShell:

```powershell
New-Item -ItemType Directory -Force C:\hirefolios-data\uploads, C:\hirefolios-backups
```

`C:\hirefolios-data\uploads` holds candidate photos and CVs. `C:\hirefolios-backups` holds the
nightly backups. Do not share either folder on the network.

## 5. Fill in the settings file

1. In `C:\hirefolios`, copy `.env.production.example` to `.env.production`.
2. Open `.env.production` in Notepad and fill in:
   - `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET`: one random value each. Make one by running
     this in PowerShell and copying the result (run it twice for two values):
     ```powershell
     $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
     ```
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (8+ characters), `SEED_ADMIN_NAME`: the first admin account.
   - `UPLOAD_HOST_DIR`: leave `C:\hirefolios-data\uploads` unless you chose another folder.
   - `CADDYFILE` and `CLOUDFLARE_API_TOKEN`: see step 6.
3. Save. Keep this file private: it holds the passwords. Never email it or put it in a shared folder.

## 6. Choose how HTTPS works

The webcam only works on an `https://` address, so Hirefolios always uses HTTPS. Pick one option.

### Option A: real certificate from Let's Encrypt (recommended if you use Cloudflare)

No setup on the other PCs. Needs the internet on the server PC about once every two months
(to renew the certificate).

1. Sign in to Cloudflare → **My Profile → API Tokens → Create Token**.
2. Use the **Edit zone DNS** template. Under "Zone Resources" pick **Specific zone → hirefolios.in**.
   Create the token and copy it (Cloudflare shows it only once).
3. In `.env.production` set `CADDYFILE=Caddyfile.cloudflare` and paste the token after `CLOUDFLARE_API_TOKEN=`.

### Option B: the server's own certificate (no internet, no Cloudflare)

In `.env.production` set `CADDYFILE=Caddyfile.internal`. After step 8 you install the server's
certificate once on every office PC (step 9).

## 7. Point the name at the server PC

Every office PC must find `simplen.hirefolios.in` at the server address. Use **one** of these:

- **Router (best, one place):** in the router's admin page, find **Local DNS**, **Static DNS** or
  **Host mapping** and add `simplen.hirefolios.in` → the server address.
- **Cloudflare (option A only):** add a DNS record: type `A`, name `simplen`, content = the server
  address, proxy status **DNS only** (grey cloud). Some routers block this ("DNS rebinding
  protection"); if the check below fails, use the router or hosts-file method.
- **Hosts file on each PC:** open Notepad **as administrator**, open
  `C:\Windows\System32\drivers\etc\hosts`, add a line such as
  `192.168.1.20   simplen.hirefolios.in` and save. Do the same on the server PC itself.

Check, on every PC: `ping simplen.hirefolios.in` shows the server address.

## 8. Start Hirefolios

In PowerShell:

```powershell
cd C:\hirefolios
docker compose --env-file .env.production up -d --build
```

The first start takes 5 to 15 minutes (it downloads and builds everything). Later starts take seconds.

Check:

```powershell
docker compose --env-file .env.production ps
```

`db`, `app` and `caddy` show **running** (app shows **healthy** after about a minute). Then open
**https://simplen.hirefolios.in/api/health** in a browser on the server PC: it shows `"status":"ok"`.

If other PCs cannot open the address but the server PC can, allow the ports through the Windows
firewall (PowerShell as administrator):

```powershell
New-NetFirewallRule -DisplayName "Hirefolios HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

If the start fails because port 80 or 443 is busy, another program (often IIS or Skype) is using it; stop that program.

## 9. Option B only: trust the server's certificate on each PC

Copy the certificate out of the server (on the server PC, in `C:\hirefolios`):

```powershell
docker compose --env-file .env.production cp caddy:/data/caddy/pki/authorities/local/root.crt C:\hirefolios-backups\hirefolios-root.crt
```

Then, on **every** office PC (including the server PC), copy `hirefolios-root.crt` over (USB stick
or a shared folder) and in PowerShell **as administrator**:

```powershell
certutil -addstore -f Root C:\path\to\hirefolios-root.crt
```

(Or double-click the file → **Install Certificate → Local Machine → Place all certificates in the
following store → Trusted Root Certification Authorities**.) Restart the browser.

Check: https://simplen.hirefolios.in opens with a padlock and no warning. This certificate
stays valid for 10 years; keep `hirefolios-root.crt` for new PCs.

## 10. First sign-in

1. Open https://simplen.hirefolios.in and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. Click **Change password** (top right, under your name) and set a new one now: the password in
   `.env.production` is only for this first sign-in.
3. In `.env.production`, clear the `SEED_ADMIN_PASSWORD=` value (leave the line) so the password
   is no longer stored in the file. Nothing needs restarting.
4. Go to **Staff** and add HR, managers, interviewers and a **display** account for the lobby TV.
   Each person sets their own password at first sign-in.
5. **Candidates** page: the admin sees a **Server status** box (database, free disk, last backup).

## 11. Nightly backup (6:15 pm, Monday to Saturday)

Each backup is a folder in `C:\hirefolios-backups` named by date and time, holding
`database.dump` (all records) and `uploads.tar.gz` (photos and CVs). Folders older than 14 days
are removed. `backup.log` in the same folder lists every run.

Run one by hand first, in PowerShell:

```powershell
cd C:\hirefolios
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\backup.ps1
```

Check: it prints `Backup saved: ...`, and the Server status box shows the time.

Then schedule it (PowerShell, signed in as the same user that runs Docker Desktop):

```powershell
schtasks /create /tn "Hirefolios backup" /sc weekly /d MON,TUE,WED,THU,FRI,SAT /st 18:15 /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\deploy\backup.ps1"
```

Check: open **Task Scheduler**, find "Hirefolios backup", right-click → **Run**, then look at
`C:\hirefolios-backups\backup.log`. The PC must be on and signed in at 6:15 pm.

**Keep a copy somewhere else.** A backup on the same disk does not survive a dead disk or theft.
Add `-OffsiteDir E:\hirefolios-backups` (a USB disk, or a folder synced by Google Drive / OneDrive)
to the end of the command in the task. To keep more days, add `-KeepDays 30`.

## 12. Restoring a backup

Only when something has gone wrong (for example a broken disk replaced and Hirefolios
installed again). Restoring **replaces all current data** with the backup.

```powershell
cd C:\hirefolios
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\restore.ps1 -From C:\hirefolios-backups\2026-11-11_1815
```

It asks you to type `RESTORE`, makes a backup of the current state first, puts the database and
files back, and keeps the old uploads folder next to the new one (`...uploads.before-restore-...`)
until you delete it.

On a new PC: do steps 1 to 8 with the **same** `.env.production` (same passwords), copy the
backup folder over, then run the restore.

## 13. Installing a new version

1. Run a backup by hand (step 11).
2. Replace the files in `C:\hirefolios` with the new version. Keep your `.env.production`.
3. `docker compose --env-file .env.production up -d --build`

Database changes are applied automatically when the app starts.

## 14. When something is wrong

| What you see | What to do |
|---|---|
| Page does not open anywhere | Is the server PC on and signed in, with Docker Desktop running? Then `docker compose --env-file .env.production ps` |
| Opens on the server PC but not others | Step 7 check (`ping`) and the firewall rule in step 8 |
| Certificate warning | Option B: step 9 not done on that PC. Option A: check `docker compose --env-file .env.production logs caddy --tail 50` |
| Webcam blocked | The address must start with `https://`. Click the camera icon in the address bar → Allow |
| Server status shows a problem | `docker compose --env-file .env.production logs app --tail 100` and send the output to your developer |
| Last backup is old | Look at `C:\hirefolios-backups\backup.log` and the task in Task Scheduler |

Send logs to your developer, never `.env.production`.

## Linux server (optional)

The same files work on a Linux server with Docker: use `deploy/backup.sh` and
`deploy/restore.sh` (each explains its options at the top) and a cron line such as
`15 18 * * 1-6 /opt/hirefolios/deploy/backup.sh`. Make the uploads folder writable by user id 1001
(`sudo chown 1001:1001 /srv/hirefolios/uploads`).

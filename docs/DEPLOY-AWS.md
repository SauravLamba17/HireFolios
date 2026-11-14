# Running Hirefolios on AWS (Mumbai, ap-south-1)

This guide is for the person setting up the server, who does not need to be a developer. Hirefolios can run in two ways:

| | Office PC (`docs/INSTALL.md`) | AWS (this guide) |
|---|---|---|
| Who can open it | Office network only | The internet, over HTTPS |
| Database | PostgreSQL 16 on the PC | Managed PostgreSQL 16 (Lightsail database or RDS) |
| Photos, CVs, logo | A folder on the PC (`STORAGE_DRIVER=local`) | A private S3 bucket (`STORAGE_DRIVER=s3`) |
| Backups | `backup.ps1` to a folder or USB drive | Nightly encrypted dump to a second S3 bucket, plus the managed database's own backups |
| HTTPS | Caddy on the PC | Caddy in a container, with a Let's Encrypt certificate |

Both run the same program. Nothing in this guide changes the office-PC install.

> **Status:** these steps were written and tested **without an AWS account**. The S3 code ran against an
> S3-compatible test server, and the database code ran against a local PostgreSQL with the same settings.
> Section 15 lists what must be checked on the first real deployment.

There are two ways to set it up. Pick one:

- **Option A: Lightsail.** Simplest and cheapest, with fixed monthly prices. Recommended for Simplen.
- **Option B: EC2 + RDS.** More control (an IAM role instead of a key, Multi-AZ, larger sizes). Use it when you outgrow Lightsail.

---

## 1. Before you start

- An AWS account. Turn on MFA for the root user, then stop using root: create an admin IAM user (or IAM Identity
  Center user) for yourself.
- The domain `hirefolios.in`, where you can add DNS records.
- Region **Asia Pacific (Mumbai) ap-south-1** for everything (candidate data stays in India).
- About 2 hours.

**SESS stays separate.** If SESS runs in the same AWS account, give Hirefolios its own resources: its own instance,
its own database (never a schema inside SESS's), its own buckets and its own IAM user or role (whose policy names only
the Hirefolios buckets). Tag every Hirefolios resource with `app = hirefolios`, so the bill and the console can be
filtered. (A separate AWS account under AWS Organizations is stronger still, but not required.)

### Names used in this guide

| Resource | Name |
|---|---|
| Server (Lightsail instance or EC2) | `hirefolios-simplen` |
| Static IP / Elastic IP | `hirefolios-simplen-ip` |
| Database | `hirefolios-simplen-db` (database `hirefolios`, user `hirefolios`) |
| Bucket for photos, CVs, logo | `hirefolios-simplen-uploads` |
| Bucket for database backups | `hirefolios-simplen-backups` |
| IAM user (Lightsail) or role (EC2) | `hirefolios-app` |
| IAM policy | `hirefolios-app-s3` |
| DNS record | `simplen.hirefolios.in` → the static IP |

Bucket names are global across AWS. If a name is taken, add a short suffix (e.g. `-in1`) and use the same name
everywhere below.

---

## 2. Option A — Lightsail

### 2.1 The server

1. Lightsail console → **Create instance**. Region **Mumbai**. Platform **Linux/Unix**. Blueprint **OS only → Ubuntu 24.04 LTS**.
2. Size: **2 GB RAM** (1 GB is too small to update the app comfortably). Name it `hirefolios-simplen`. Create.
3. **Networking → Create static IP**, name it `hirefolios-simplen-ip`, and attach it to the instance.
4. **Networking → IPv4 firewall**. Keep only these three rules:
   - HTTP 80: any address (Let's Encrypt needs it; Caddy redirects it to HTTPS)
   - HTTPS 443: any address
   - SSH 22: **restricted to your own IP address** ("Restrict to IP address" → your office's or home IP)

   Do the same for IPv6, or turn IPv6 networking off.

### 2.2 The database

1. Lightsail → **Databases → Create database**. Region **Mumbai**. **PostgreSQL 16** (the app refuses other majors).
2. Plan: **Standard** is fine for one company (1 GB RAM, 40 GB). Choose **High availability** if you want a standby.
3. Master username `hirefolios`, with a long generated password. Save it in your password manager.
4. Name it `hirefolios-simplen-db`. Create it and wait about 15 minutes.
5. Leave **Public mode** **off**. Only resources in the same Lightsail region can reach it.
6. Note the **endpoint**. You need it for `DATABASE_URL` in section 4.
7. Create the database itself from the server once (section 3.4). Automatic backups are on by default (7 days,
   point-in-time). Keep them on.

### 2.3 Buckets

Make both buckets in the **S3 console** (not Lightsail object storage, so the policy, lifecycle and versioning below
apply as written). For each of `hirefolios-simplen-uploads` and `hirefolios-simplen-backups`:

1. S3 → **Create bucket**, region **ap-south-1**.
2. **Object Ownership:** ACLs disabled.
3. **Block all public access:** **on** (all four boxes).
4. **Default encryption:** SSE-S3 (Amazon S3 managed keys).
5. **Bucket Versioning:** **Enable** on `hirefolios-simplen-backups`. On uploads, see section 7.3.
6. Tags: `app = hirefolios`.

Then add the backup lifecycle rules (section 7.2) and the "HTTPS only" bucket policy below to **both** buckets
(Permissions → Bucket policy; replace the bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "HttpsOnly",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::hirefolios-simplen-uploads", "arn:aws:s3:::hirefolios-simplen-uploads/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

### 2.4 The app's AWS access (least privilege)

Lightsail instances cannot have an IAM role, so the app uses the access key of an IAM user that can do nothing but
this:

1. IAM → **Policies → Create policy → JSON**, paste the policy below, and name it `hirefolios-app-s3`.
2. IAM → **Users → Create user** `hirefolios-app`, with **no console access**, and attach `hirefolios-app-s3`.
3. User → **Security credentials → Create access key → "Application running outside AWS"**. Copy both values
   straight into `hirefolios.env` (section 4). Do not save them anywhere else.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UploadsReadWrite",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::hirefolios-simplen-uploads/*"
    },
    {
      "Sid": "UploadsList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::hirefolios-simplen-uploads"
    },
    {
      "Sid": "BackupsWriteAndRead",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::hirefolios-simplen-backups/*"
    },
    {
      "Sid": "BackupsList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::hirefolios-simplen-backups"
    }
  ]
}
```

Notes:
- The app **cannot delete backups**. The lifecycle rules remove old ones, so a stolen key cannot wipe your backup history.
- `HeadBucket` (the health check) is allowed by `s3:ListBucket`. `CopyObject` (the monthly copy) uses Get + Put.
- With `S3_SSE=aws:kms` and your own KMS key, also allow `kms:GenerateDataKey` and `kms:Decrypt` on that key.
  SSE-S3 (`AES256`, the default) needs nothing extra.
- Rotate the access key once a year: create the new key, update `hirefolios.env`, restart, then delete the old key.

### 2.5 DNS

At your DNS provider, add an **A record**: `simplen` → the static IP. Wait until `nslookup simplen.hirefolios.in`
shows that IP before starting Caddy, or Let's Encrypt fails, and repeated failures are rate-limited for an hour.

---

## 3. Prepare the server (both options)

SSH in (Lightsail: **Connect using SSH**, or `ssh ubuntu@<static IP>` with the key you downloaded).

### 3.1 Updates and Docker

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades ca-certificates curl postgresql-client-16 || sudo apt -y install postgresql-client
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # log in again so the group applies
```

### 3.2 The app files

On your own PC, in the Hirefolios source folder, build the image and send it to the server. You need Docker Desktop
for this, or build on the server instead:

```bash
docker build -f deploy/docker/Dockerfile -t hirefolios:0.1.0 .
docker save hirefolios:0.1.0 | gzip > hirefolios-0.1.0.tar.gz
scp hirefolios-0.1.0.tar.gz deploy/docker/docker-compose.aws.yml deploy/docker/Caddyfile.aws deploy/docker/env.aws.example ubuntu@<static IP>:/tmp/
```

On the server:

```bash
sudo mkdir -p /opt/hirefolios && sudo chown ubuntu /opt/hirefolios && cd /opt/hirefolios
mv /tmp/docker-compose.aws.yml /tmp/Caddyfile.aws .
cp /tmp/env.aws.example hirefolios.env && chmod 600 hirefolios.env
gunzip -c /tmp/hirefolios-0.1.0.tar.gz | docker load
```

(Option: push the image to a private Amazon ECR repository instead of copying the file.)

### 3.3 The database certificate

The connection to the database is encrypted, and with `DB_SSL=verify-full` the app also checks that it is really AWS's
database:

```bash
curl -o /opt/hirefolios/rds-ca.pem https://truststore.pki.rds.amazonaws.com/ap-south-1/ap-south-1-bundle.pem
```

### 3.4 Create the database

```bash
psql "host=<endpoint> user=hirefolios dbname=postgres sslmode=require" -c "CREATE DATABASE hirefolios"
psql "host=<endpoint> user=hirefolios dbname=hirefolios sslmode=require" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
```

The first migration also enables `pg_trgm`. The app stops with a clear message if the database does not allow it.

---

## 4. The settings file `hirefolios.env`

Open it with `nano /opt/hirefolios/hirefolios.env` and fill in every empty value. Each one is explained in the file,
and the full list is in section 12. The ones you must set:

| Setting | Value |
|---|---|
| `BETTER_AUTH_URL` | `https://simplen.hirefolios.in` |
| `BETTER_AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` (new, never the office PC's) |
| `DATABASE_URL` | `postgres://hirefolios:<password>@<endpoint>:5432/hirefolios` (URL-encode special characters in the password) |
| `DB_SSL` / `DB_SSL_CA_FILE` | `verify-full` / `/app/certs/rds-ca.pem` |
| `S3_BUCKET` / `BACKUP_BUCKET` | the two bucket names |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | the `hirefolios-app` key (Lightsail). Leave both empty on EC2 |
| `BACKUP_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (**print it and keep it offline**) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | the first admin (removed again in section 5) |

No Node.js on the server? Generate the two random values on any PC, or use `openssl rand -base64 32`.

At start-up the app checks every value. If one is missing or wrong, it stops, and `docker compose logs app` names the
variable. Secrets are never printed in the logs.

**Keeping secrets in AWS SSM Parameter Store (optional).** Instead of typing secrets into the file, store each one as a
*SecureString* under `/hirefolios/simplen/<NAME>` and write the file at boot:

```bash
aws ssm get-parameters-by-path --path /hirefolios/simplen/ --with-decryption --region ap-south-1 \
  --query "Parameters[].[Name,Value]" --output text | sed 's#^/hirefolios/simplen/##; s#\t#=#' > /opt/hirefolios/hirefolios.env
chmod 600 /opt/hirefolios/hirefolios.env
```

The instance then needs `ssm:GetParametersByPath` on `arn:aws:ssm:ap-south-1:<account>:parameter/hirefolios/simplen/*`.
That is easy on EC2 (add it to the role). On Lightsail it would need a second IAM key, so the plain `chmod 600` file is
the simpler choice there.

---

## 5. Start it

```bash
cd /opt/hirefolios
export PUBLIC_DOMAIN=simplen.hirefolios.in TLS_MODE=you@yourcompany.in HIREFOLIOS_VERSION=0.1.0
docker compose -f docker-compose.aws.yml up -d
docker compose -f docker-compose.aws.yml logs -f app     # wait for "ready"; Ctrl+C to stop watching
```

Put the three `export` lines in `/opt/hirefolios/.env` (Compose reads that file itself), so later commands need no
exports:

```
PUBLIC_DOMAIN=simplen.hirefolios.in
TLS_MODE=you@yourcompany.in
HIREFOLIOS_VERSION=0.1.0
```

On the first start, the app applies the database migrations (holding a lock, so two copies never migrate at once),
creates the company and the first admin, and starts the nightly backup and the deletion job.

**Check it works:**

1. `curl https://simplen.hirefolios.in/api/health` returns `"status":"ok"`, with `"database":true` and `"storage":{"driver":"s3","ok":true}`.
2. Open https://simplen.hirefolios.in in Chrome. The padlock shows a valid certificate.
3. Sign in as the first admin. You are asked to set up **two-factor sign-in**: scan the QR code with an authenticator
   app (Google Authenticator, Microsoft Authenticator, 1Password …), type the code, and **save the 10 recovery codes**
   somewhere safe.
4. Remove `SEED_ADMIN_PASSWORD` from `hirefolios.env`, then run `docker compose -f docker-compose.aws.yml up -d`.
5. Follow `docs/INSTALL.md` section 8 (staff accounts) and Settings → Company / Lists / Privacy notice as on the office PC.
6. Optional: **Settings → Security → office IP allow-list.** When it is on, people can sign in only from the listed
   addresses, and the lobby TV works only from them. The page shows your current address, and it refuses to switch on
   unless your own address is listed. If everyone gets locked out anyway, set `IP_ALLOWLIST_OFF=1` in the env file,
   restart, fix the list, and set it back to `0`.

---

## 6. Option B — EC2 + RDS

The same as option A except for these steps:

| Step | EC2 + RDS |
|---|---|
| Server | EC2 → Launch instance in ap-south-1. Ubuntu 24.04, `t4g.small` (Arm, 2 GB) or `t3.small`, 20 GB gp3. Require IMDSv2. Name `hirefolios-simplen` |
| Address | An **Elastic IP** `hirefolios-simplen-ip`, associated with the instance |
| Firewall | Security group `hirefolios-web`: 80 and 443 from anywhere, 22 from your IP only (or no 22 at all, using **SSM Session Manager**) |
| Database | RDS → PostgreSQL **16.x**, `db.t4g.micro` (1 GB) or `db.t4g.small`, 20 GB gp3, storage encrypted. **Public access: No**. Security group `hirefolios-db` that allows 5432 **only from `hirefolios-web`**. Automated backups 7–35 days. Deletion protection on. Multi-AZ if you want a standby |
| Force TLS | Use a parameter group with `rds.force_ssl = 1` (the default on PostgreSQL 16) |
| AWS access | IAM **role** `hirefolios-app` (trusted entity: EC2) with the policy from section 2.4, attached to the instance. Leave `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` **empty**: the SDK uses the role, and there is no key to leak or rotate. Docker containers reach the role through IMDSv2. Set the instance's metadata hop limit to 2 (`aws ec2 modify-instance-metadata-options --http-put-response-hop-limit 2`) |
| Secrets | SSM Parameter Store (section 4) is easy here: add `ssm:GetParametersByPath` to the role |

Everything else (buckets, DNS, `hirefolios.env`, compose, checks) is the same.

---

## 7. Backups

### 7.1 Two layers

1. **The managed database's own backups.** Lightsail databases and RDS take a nightly snapshot and keep the logs for
   point-in-time restore (default 7 days). Restoring one creates a **new** database: put its endpoint in
   `DATABASE_URL` and restart. Before a big change, take a manual snapshot.
2. **Hirefolios' own nightly dump** (`BACKUP_BUCKET`), because a managed snapshot cannot leave AWS and disappears with
   the database. Every night at `BACKUP_TIME` (IST), one app instance (under a lock) runs `pg_dump`, encrypts the
   dump with `BACKUP_ENCRYPTION_KEY` (AES-256-GCM), and uploads it:

   ```
   daily/2026-11-14/hirefolios-20261114-0230.dump.enc   (+ .json: size, SHA-256, app version)
   monthly/2026-11/hirefolios-20261101-0230.dump.enc    (the first backup of each month)
   status/last-backup.json                              (what the status card and /api/health show)
   ```

   The dump holds the database only. Photos and CVs stay in the uploads bucket (section 7.3).

### 7.2 Lifecycle: 30 daily and 12 monthly

On `hirefolios-simplen-backups`, go to **Management → Create lifecycle rule**, or paste the rules below with
`aws s3api put-bucket-lifecycle-configuration`:

```json
{
  "Rules": [
    { "ID": "daily-30-days", "Status": "Enabled", "Filter": { "Prefix": "daily/" },
      "Expiration": { "Days": 30 }, "NoncurrentVersionExpiration": { "NoncurrentDays": 7 } },
    { "ID": "monthly-12-months", "Status": "Enabled", "Filter": { "Prefix": "monthly/" },
      "Expiration": { "Days": 365 }, "NoncurrentVersionExpiration": { "NoncurrentDays": 7 },
      "Transitions": [ { "Days": 30, "StorageClass": "STANDARD_IA" } ] },
    { "ID": "abort-incomplete-uploads", "Status": "Enabled", "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 2 } }
  ]
}
```

### 7.3 Uploads bucket: versioning

Turning on **versioning** for `hirefolios-simplen-uploads` lets you recover a file deleted or overwritten by mistake.
But the privacy deletion job (and erasure requests) must really remove data. If you turn it on, also add this rule, so
a deleted photo or CV is gone for good after 7 days:

```json
{ "Rules": [ { "ID": "deleted-files-gone-after-7-days", "Status": "Enabled", "Filter": { "Prefix": "" },
  "NoncurrentVersionExpiration": { "NoncurrentDays": 7 },
  "Expiration": { "ExpiredObjectDeleteMarker": true } } ] }
```

Mention the 7 days in the privacy notice's retention text if you rely on it. Without versioning, a deletion is
immediate and final. The app never overwrites a file (every upload gets a new key), so versioning only matters for
deletions.

### 7.4 Backup now, list, restore

All three run inside the app container, which has `pg_dump` / `pg_restore` 16:

```bash
cd /opt/hirefolios
docker compose -f docker-compose.aws.yml exec app node tools/backup-s3.js            # back up now
docker compose -f docker-compose.aws.yml exec app node tools/backup-s3.js --list     # daily/ then monthly/, oldest first
```

**Restore (replaces everything in the database):**

1. Stop the app: `docker compose -f docker-compose.aws.yml stop app`.
2. Run it once, outside the service:
   `docker compose -f docker-compose.aws.yml run --rm --no-deps app node tools/backup-s3.js --restore latest --yes`
   (or a key from `--list` in place of `latest`). It downloads the file, checks the SHA-256, decrypts it, and
   restores it in a single transaction. If anything is wrong, nothing changes.
3. Start the app again: `docker compose -f docker-compose.aws.yml up -d`.
4. Check: sign in, open a few candidates, open their photos.

To restore into a **new** database instead (safer, for a drill), create it, set `DATABASE_URL` to it for the run
command only (`-e DATABASE_URL=...`), and compare.

**Test a restore once a quarter** (a restore drill): restore the latest backup into a throwaway database, sign in,
and check the counts on the reports page. Record the date.

**Lost encryption key = lost backups.** Keep `BACKUP_ENCRYPTION_KEY` printed in a sealed envelope or in a password
manager that is not on this server.

---

## 8. Health checks and alarms

`GET https://simplen.hirefolios.in/api/health` needs no sign-in and returns no personal data:

```json
{ "status": "ok", "database": true, "storage": { "driver": "s3", "ok": true },
  "disk": { "freeGB": 12.3 }, "lastBackupAt": "2026-11-14T21:00:04.000Z", "version": "0.1.0", "time": "..." }
```

It answers HTTP 200 when everything is fine and 503 when the database or storage is down. The container's
`HEALTHCHECK` uses it, so `docker ps` shows `healthy` or `unhealthy`.

Set up at least:

1. **Uptime check (free):** any external monitor (UptimeRobot, Better Stack, or a Route 53 health check) on
   `https://simplen.hirefolios.in/api/health` every 5 minutes, alerting by email when it does not answer 200, or when
   the text `"status":"ok"` is missing.
2. **Lightsail:** instance → **Metrics → Add alarm** for CPU over 80% for 15 minutes and for status check failures.
   Database → **Metrics** alarms on CPU, free storage space under 5 GB, and database connections over 60. Set the
   notification email under **Account → Notifications**.
3. **EC2 + RDS (CloudWatch):** alarms on EC2 `StatusCheckFailed`, RDS `CPUUtilization`, `FreeStorageSpace`,
   `DatabaseConnections` and `FreeableMemory`, each to an SNS topic `hirefolios-alerts` with your email. Optional:
   install the CloudWatch agent to ship the app's JSON logs (`docker logs`) to a log group `hirefolios` with 30-day
   retention.
4. **Backups:** the admin status card shows "Last backup". Look at it weekly. The uptime monitor can also alert when
   `lastBackupAt` is older than 26 hours (keyword monitors can match the date).
5. **Billing:** AWS Budgets → a monthly cost budget (for example USD 60) with an email alert at 80%.

The app logs one JSON line per event to stdout (`docker compose logs app`), carrying ids and codes only, never names,
mobiles or emails. Caddy's access log drops query strings and cookies.

---

## 9. Installing a new version

```bash
# on your PC
docker build -f deploy/docker/Dockerfile -t hirefolios:0.2.0 . && docker save hirefolios:0.2.0 | gzip > hirefolios-0.2.0.tar.gz
scp hirefolios-0.2.0.tar.gz ubuntu@<static IP>:/tmp/
# on the server
gunzip -c /tmp/hirefolios-0.2.0.tar.gz | docker load
cd /opt/hirefolios
docker compose -f docker-compose.aws.yml exec app node tools/backup-s3.js     # a fresh backup first
sed -i 's/^HIREFOLIOS_VERSION=.*/HIREFOLIOS_VERSION=0.2.0/' .env
docker compose -f docker-compose.aws.yml up -d                                  # migrations run on start
curl -s https://simplen.hirefolios.in/api/health                                # "version":"0.2.0"
```

Also take a manual database snapshot in the console before a version that changes the database (the release notes
say so).

## 10. Rolling back

- **The app only** (the new version misbehaves, and its migrations only *added* things, which is the rule for this
  project): set `HIREFOLIOS_VERSION` back to the old version and run `docker compose -f docker-compose.aws.yml up -d`.
  Keep the old image on the server (`docker images`) until the new one has run a full drive day.
- **App and data** (a migration damaged data): stop the app, restore the snapshot you took before the update (console
  → new database → new endpoint in `DATABASE_URL`) or the latest Hirefolios backup (section 7.4), then start the old
  version.

---

## 11. Security summary (what is on for the internet)

| Protection | Where |
|---|---|
| HTTPS only, HSTS (1 year), automatic certificate | Caddy + the app's headers |
| Content Security Policy with a per-request nonce, `frame-ancestors 'none'`, no-sniff, referrer `same-origin`, camera only for the app | `src/middleware.ts` |
| Cookies `Secure`, `HttpOnly`, `SameSite=Lax`; cross-site writes refused | Better Auth + `requireStaffApi` |
| Two-factor sign-in (authenticator app + 10 single-use recovery codes), required for the roles in `TWO_FACTOR_REQUIRED_ROLES` (`admin,hr`); admins can reset it for someone who lost their phone | Account menu → Sign-in security; Users page |
| Sign-in limit per internet address (`SIGN_IN_LIMIT`), account lock after `LOCKOUT_ATTEMPTS` wrong passwords for `LOCKOUT_MINUTES` (audited; admins can unlock), two-factor code attempts limited | `src/lib/auth.ts` |
| API limit per signed-in person (`API_RATE_LIMIT_PER_MINUTE`) | `requireStaffApi` |
| Optional office IP allow-list; lobby TV only from it | Settings → Security |
| Password change and admin reset end all other sessions; "Sign out everywhere" | Account menu |
| Files private: Block Public Access, the app streams after login + tenant checks; optional short signed links (`S3_SIGNED_URLS=on`, 60 s) | `/api/files/[id]` |
| Container: non-root user, read-only file system, no Linux capabilities, 1 GB memory cap | `docker-compose.aws.yml` |
| Database: private, TLS with certificate check, encrypted storage | section 2.2 / 6 |

Signed links are off by default because a signed link works for anyone holding it until it expires. Streaming through
the app checks the login on every request. Turn them on only if large files make the server slow.

---

## 12. Every setting (names only; values in `hirefolios.env`)

| Group | Variables |
|---|---|
| Public address | `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_TRUSTED_ORIGINS` (optional) |
| Database | `DATABASE_URL`, `DB_SSL` (`disable` / `require` / `verify-full`), `DB_SSL_CA_FILE`, `DB_POOL_MAX`, `RUN_MIGRATIONS`, `SEED_ON_START`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` |
| Files | `STORAGE_DRIVER` (`local` / `s3`), `UPLOAD_DIR` (local only), `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` (test servers only), `S3_FORCE_PATH_STYLE`, `S3_SSE` (`AES256` / `aws:kms` / `none`), `S3_SIGNED_URLS`, `S3_SIGNED_URL_SECONDS`, `MAX_UPLOAD_MB`, `MAX_CV_FILES`, `MAX_CV_PAGES` |
| AWS credentials | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (Lightsail; empty on EC2 with a role) |
| Backups | `BACKUP_BUCKET`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_TIME`, `PG_DUMP_PATH`, `PG_RESTORE_PATH` |
| Security | `TWO_FACTOR_REQUIRED_ROLES`, `SIGN_IN_LIMIT`, `LOCKOUT_ATTEMPTS`, `LOCKOUT_MINUTES`, `API_RATE_LIMIT_PER_MINUTE`, `IP_ALLOWLIST_OFF`, `STAFF_SESSION_HOURS`, `DISPLAY_SESSION_DAYS` |
| Housekeeping | `PURGE_JOB`, `OFFICE_HOURS`, `LOG_FORMAT` (`json` on AWS), `APP_VERSION` |
| Compose only (`/opt/hirefolios/.env`) | `PUBLIC_DOMAIN`, `TLS_MODE`, `HIREFOLIOS_VERSION`, `HIREFOLIOS_ENV_FILE` |

Each setting is explained in `.env.example` and `deploy/docker/env.aws.example`.

---

## 13. Moving the office PC's files to S3

When moving an existing office-PC install to AWS:

1. On the office PC, take a backup (`backup.ps1`), then restore the database into the AWS database:
   `pg_restore --no-owner --no-acl -d "<DATABASE_URL>?sslmode=require" hirefolios.dump`.
2. Copy the photos and CVs, with a dry run first. In the release folder on a PC that has the uploads folder and the
   AWS key, run `C:\hirefolios\app\node\node.exe --env-file=<settings file> C:\hirefolios\app\tools\migrate-files-to-s3.js` (or `npm run files:to-s3` from the source). It lists what it would copy and changes
   nothing. Then run it with `--apply`: it uploads each file, reads it back, compares the SHA-256 checksums, and
   prints a summary. Files already in the bucket with the same checksum are skipped, so it can be run again after an
   interruption. It never deletes the local files: keep them until AWS has run a full drive day.

---

## 14. Costs (estimates — verify in the AWS console)

Prices in **USD per month for ap-south-1**, from AWS's public price lists as remembered at the time of writing. They
change. **Check the Lightsail pricing page and the AWS Pricing Calculator before you decide.** Taxes (18% GST in
India) are extra.

| Item | Option A: Lightsail | Option B: EC2 + RDS |
|---|---|---|
| Server, 2 GB RAM | ~ $12 (instance bundle, data transfer included) | ~ $12–15 (`t4g.small` on demand) + ~ $2 (20 GB gp3) |
| Static / Elastic IP | $0 while attached | ~ $3.6 (every public IPv4 address is billed) |
| PostgreSQL 16 | ~ $15 (Standard, 1 GB) · ~ $30 with high availability | ~ $15–20 (`db.t4g.micro`) + ~ $3 (20 GB) · roughly double with Multi-AZ |
| S3 uploads (10 GB) | ~ $0.25 | ~ $0.25 |
| S3 backups (30 daily + 12 monthly, 50 MB each) | < $0.10 | < $0.10 |
| Requests, data transfer out | small (Lightsail includes transfer) | ~ $1–3 |
| **Total, approximate** | **~ $28–45** | **~ $35–60** |

Savings Plans or reserved instances lower option B by about 30–40% for a 1-year commitment.

---

## 15. What still needs checking on the real AWS account

These could not be tested without an AWS account:

- The Lightsail database offers PostgreSQL **16** in Mumbai and allows `pg_trgm`.
- `DB_SSL=verify-full` with the ap-south-1 CA bundle against the real endpoint.
- The real S3 path: SSE-S3 headers (the test server refused them, so the tests ran with `S3_SSE=none`), the IAM policy
  above being enough (no `AccessDenied` in the logs during a full drive day), the lifecycle rules, and "HTTPS only".
- The EC2 instance role reaching containers (IMDSv2 hop limit 2).
- The container build and run (`docker build`, `docker compose up`): it was written but not run on the development PC.
- The Let's Encrypt certificate for the real domain.
- The alarms and the uptime monitor actually sending email.

---

## 16. Go-live checklist

- [ ] Region ap-south-1 for the server, database and both buckets; everything tagged `app = hirefolios`
- [ ] Root user has MFA and is not used day to day; billing budget alert set
- [ ] Firewall / security group: 80 and 443 open, 22 only from your IP (or closed, using SSM)
- [ ] Database: PostgreSQL 16, not public, automatic backups on, deletion protection (RDS), `DB_SSL=verify-full`
- [ ] Both buckets: Block Public Access on, SSE-S3 on, HTTPS-only policy; backups bucket versioned with the lifecycle rules
- [ ] IAM: `hirefolios-app` has only the `hirefolios-app-s3` policy; no other keys in `hirefolios.env`
- [ ] `hirefolios.env` is `chmod 600`, not in git, not in the image; `BETTER_AUTH_SECRET` is new; `SEED_ADMIN_PASSWORD` removed after the first sign-in
- [ ] `BACKUP_ENCRYPTION_KEY` stored offline, and a restore drill done once into a throwaway database
- [ ] `TWO_FACTOR_REQUIRED_ROLES=admin,hr`; the first admin set up two-factor and stored the recovery codes
- [ ] `https://simplen.hirefolios.in/api/health` shows `ok` with storage `s3`; padlock valid
- [ ] Uptime monitor and alarms send email (test by stopping the app once)
- [ ] One full test drive (intake with webcam → interview → decision → TV), then check that the photo is in the bucket and not public
- [ ] Office IP allow-list decided (on with the office's address, or off)
- [ ] The office PC install (if kept) is backed up and stopped, so two systems do not take walk-ins
- [ ] SESS resources are untouched, and Hirefolios has its own database and buckets

# Docker deployment (AWS)

**Supported (Phase 5):** `Dockerfile`, `docker-compose.aws.yml`, `Caddyfile.aws` and `env.aws.example`. These run
Hirefolios on one AWS server with managed PostgreSQL 16 and S3. Follow `docs/DEPLOY-AWS.md`. Simplen's office PC
still uses the native Windows install in `deploy/windows/` (`docs/INSTALL.md`). Docker is not used there.

**Superseded (Phase 3, never run, kept for reference only):** `docker-compose.yml`, `Caddyfile.internal`,
`Caddyfile.cloudflare`, `caddy/`, `backup.sh` / `backup.ps1`, `restore.sh` / `restore.ps1`. They predate S3 storage, the
migration lock and the S3 backups. Do not use them for a new install.

The build context is the repository root, and `Dockerfile.dockerignore` keeps `.env`, `data/` and other local files out
of the image:

```bash
docker build -f deploy/docker/Dockerfile -t hirefolios:<version> .
```

**Status:** the image and compose file were written and linted but have **not been built or run** yet (no Docker on
the development PC). The first build is part of `docs/DEPLOY-AWS.md` section 15.

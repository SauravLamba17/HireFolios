# Docker deployment (optional, not used for Simplen)

These files are kept for a possible future cloud / SaaS setup. **Simplen runs the native Windows
install** in `deploy/windows/` (see `docs/INSTALL.md`). Nothing here is maintained or tested: the
Docker setup was written in Phase 3 and never run, and it is not kept in step with the app.

If it is picked up again, start from here: `cd deploy/docker`, copy `.env.production.example` to
`.env.production`, then `docker compose --env-file .env.production up -d --build`. The build context
is the repository root (`Dockerfile.dockerignore` keeps `.env` and `data/` out of the image).

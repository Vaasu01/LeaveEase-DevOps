# LeaveEase – Employee Leave Management System

A Node.js + MySQL web application with Docker and Jenkins CI/CD pipeline.

---

## Tech Stack

| Layer      | Technology              |
|------------|-------------------------|
| Backend    | Node.js, Express.js     |
| Templating | EJS                     |
| Database   | MySQL 8                 |
| Auth       | bcrypt + express-session|
| Container  | Docker, Docker Compose  |
| CI/CD      | Jenkins (versioned)     |

---

## Default Login Credentials

| Role     | Email                  | Password  |
|----------|------------------------|-----------|
| Admin    | admin@leaveease.com    | admin123  |
| Employee | Created by admin only  | (set by admin) |

---

## Option A – Run Locally (without Docker)

**Prerequisites:** Node.js 18+, MySQL running locally

```bash
# 1. Install dependencies
npm install

# 2. Copy and edit environment file
cp .env.example .env
# Edit .env → set DB_PASSWORD to your MySQL root password

# 3. Create tables + seed admin user
node init-db.js

# 4. Start the app
node app.js
```

Open → http://localhost:3000

---

## Option B – Run with Docker Compose (recommended)

**Prerequisites:** Docker Desktop installed and running

```bash
# First time — build the image and start
docker build -t leaveease-app:latest .
docker-compose up -d

# Check status
docker-compose ps
```

Open → http://localhost:3000

```bash
# Stop app only (MySQL + data preserved)
docker-compose stop app

# Stop everything (data preserved)
docker-compose down

# Stop AND delete all data (fresh start)
docker-compose down -v
```

---

## Auto Migration (no manual SQL ever)

`init-db.js` runs automatically on every container start before `app.js`.

It is a **safe, idempotent migration script**:

| Operation | How it's safe |
|-----------|--------------|
| Create tables | `CREATE TABLE IF NOT EXISTS` — skipped if table exists |
| Add columns | Checks `INFORMATION_SCHEMA.COLUMNS` first — `ALTER TABLE` only runs if column is missing |
| Seed data | Checks row count before inserting — never duplicates |
| Admin password | Always refreshed to `admin123` — existing employees untouched |
| DB volume | `mysql_data` named volume — never deleted by Jenkins |

### What happens on every `git push`

```
git push
  ↓ Jenkins detects push
  ↓ Build new image: leaveease-app:BUILD_NUMBER
  ↓ Stop old app container (MySQL stays running)
  ↓ docker run new container
  ↓ Container starts → node init-db.js runs
      ├─ Connects to MySQL (retries up to 15x)
      ├─ CREATE TABLE IF NOT EXISTS (all tables)
      ├─ Checks INFORMATION_SCHEMA for missing columns
      ├─ ALTER TABLE only if column missing
      ├─ Seeds leave types if empty
      └─ Refreshes admin password
  ↓ node app.js starts
  ↓ Jenkins verifies container is running
  ↓ Jenkins curls http://localhost:3000 (fails build if down)
  ↓ localhost updated ✅
```



### What happens on every git push

```
git push origin main
       │
       ▼
Jenkins detects push (webhook or poll)
       │
       ▼
Stage 1: Checkout  – pulls latest code
Stage 2: Install   – npm ci
Stage 3: Validate  – node --check all JS files
Stage 4: Build     – docker build → leaveease-app:42 + leaveease-app:latest
Stage 5: Deploy    – stops app container only, starts new versioned container
Stage 6: Health    – curl localhost:3000 confirms app is live
       │
       ▼
http://localhost:3000 updated  ✅
MySQL data untouched           ✅
```

### Image Versioning

Every successful Jenkins build produces **two tags**:

| Tag | Example | Purpose |
|-----|---------|---------|
| `leaveease-app:BUILD_NUMBER` | `leaveease-app:42` | Permanent version — used for rollback |
| `leaveease-app:latest` | `leaveease-app:latest` | Always points to newest build |

```bash
# See all versions on your machine
docker images leaveease-app

# Output example:
# REPOSITORY      TAG    IMAGE ID       CREATED         SIZE
# leaveease-app   42     a1b2c3d4e5f6   2 minutes ago   210MB
# leaveease-app   41     b2c3d4e5f6a7   1 hour ago      210MB
# leaveease-app   latest a1b2c3d4e5f6   2 minutes ago   210MB
```

### Rollback to a Previous Version

If build 42 breaks the app, roll back to build 41 in 3 commands:

```bash
# 1. Stop and remove the broken app container
docker stop leaveease_app
docker rm   leaveease_app

# 2. Start the previous version
docker run -d \
  --name leaveease_app \
  --network leaveease_leaveease_default \
  -p 3000:3000 \
  -e DB_HOST=leaveease_mysql \
  -e DB_USER=root \
  -e DB_PASSWORD=vaasu \
  -e DB_NAME=leaveease \
  -e PORT=3000 \
  -e NODE_ENV=production \
  leaveease-app:41

# 3. Verify it's running
docker ps
curl http://localhost:3000/
```

MySQL data is **never affected** by rollback — only the app container changes.

### Jenkins Job Setup (one-time)

1. Open Jenkins → **New Item** → **Pipeline**
2. Under **Pipeline** → Source: **Pipeline script from SCM**
3. SCM: **Git** → paste your GitHub repo URL
4. Branch: `*/main`
5. Script Path: `Jenkinsfile`
6. Check: **GitHub hook trigger for GITScm polling**
7. Click **Save** → **Build Now** (once, to register triggers)

### GitHub Webhook Setup (for instant trigger)

1. GitHub repo → **Settings** → **Webhooks** → **Add webhook**
2. Payload URL: `http://YOUR_MACHINE_IP:8080/github-webhook/`
3. Content type: `application/json`
4. Event: **Just the push event**
5. Click **Add webhook**

After this: `git push` → Jenkins builds within seconds automatically.

---

## Deployment Verification Commands

```bash
# Which image is currently running?
docker inspect leaveease_app --format "Image: {{.Config.Image}}"

# See all built versions
docker images leaveease-app

# Live app logs
docker logs leaveease_app --tail=30 -f

# MySQL still has data?
docker exec leaveease_mysql mysql -uroot -pvaasu -e "SELECT COUNT(*) FROM leaveease.users;"

# Health check
curl -L http://localhost:3000/
```

---

## Project File Structure

```
LeaveEase/
├── app.js                  ← Express server + all routes
├── db.js                   ← MySQL connection
├── init-db.js              ← Creates tables + seeds data
├── middleware/
│   └── auth.js             ← requireAuth / requireAdmin / requireEmployee
├── package.json
├── .env                    ← Local secrets (NOT in Git)
├── .env.example            ← Template (safe to commit)
│
├── Dockerfile              ← Builds the Node.js image
├── docker-compose.yml      ← Runs app + MySQL (APP_IMAGE variable)
├── .dockerignore
├── Jenkinsfile             ← Versioned CI/CD pipeline
│
├── views/                  ← EJS templates
│   ├── partials/           ← Shared sidebar components
│   ├── login.ejs
│   ├── admin-dashboard.ejs
│   ├── admin-users.ejs
│   ├── admin-create-user.ejs
│   └── ...
├── public/css/             ← Stylesheets
├── routes/                 ← Express route files
└── controllers/            ← Controller stubs
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 3000 in use | `docker stop leaveease_app` then retry |
| MySQL not ready | Wait 30s, check `docker logs leaveease_mysql` |
| `Access denied` | Check `DB_PASSWORD` in `.env` matches `docker-compose.yml` |
| Image not found | Run `docker build -t leaveease-app:latest .` once manually |
| Jenkins: docker not found | Run Jenkins as your user account (not SYSTEM) |
| Rollback not working | Check network name with `docker network ls` |

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
| CI/CD      | Jenkins                 |

---

## Default Login Credentials

| Role     | Email                  | Password  |
|----------|------------------------|-----------|
| Admin    | admin@leaveease.com    | admin123  |
| Employee | Sign up at /signup     | (your own)|

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
# 1. Build and start both containers (MySQL + Node app)
docker-compose up --build

# First run takes ~60 seconds (MySQL initialises, then app seeds DB)
```

Open → http://localhost:3000

```bash
# Stop containers
docker-compose down

# Stop AND delete all data (fresh start)
docker-compose down -v
```

---

## Option C – Jenkins CI/CD Pipeline

**Prerequisites:** Jenkins with Docker installed on the agent

### Jenkins Job Setup (one-time)

1. Open Jenkins → **New Item** → **Pipeline**
2. Under **Pipeline** → Source: **Pipeline script from SCM**
3. SCM: **Git** → paste your GitHub repo URL
4. Branch: `*/main`
5. Script Path: `Jenkinsfile`
6. Click **Save** → **Build Now**

### What the pipeline does

```
Checkout → Install → Validate → Build Image → Deploy → Health Check
```

| Stage        | What happens                                      |
|--------------|---------------------------------------------------|
| Checkout     | Pulls latest code from GitHub                     |
| Install      | `npm ci` – installs exact dependencies            |
| Validate     | `node --check` on every JS file (syntax check)    |
| Build Image  | `docker build` – creates leaveease-app image      |
| Deploy       | `docker-compose up -d` – starts MySQL + app       |
| Health Check | `curl localhost:3000` – confirms app is running   |

---

## Project File Structure

```
LeaveEase/
├── app.js                  ← Express server + all routes
├── db.js                   ← MySQL connection
├── init-db.js              ← Creates tables + seeds data
├── package.json
├── .env                    ← Local secrets (NOT in Git)
├── .env.example            ← Template (safe to commit)
│
├── Dockerfile              ← Builds the Node.js image
├── docker-compose.yml      ← Runs app + MySQL together
├── .dockerignore           ← Files excluded from image
├── Jenkinsfile             ← CI/CD pipeline definition
│
├── views/                  ← EJS templates (HTML pages)
├── public/                 ← CSS, images, client JS
├── routes/                 ← Express route files
├── controllers/            ← Controller logic
└── db/schema.sql           ← Reference SQL schema
```

---

## Useful Commands

```bash
# View live container logs
docker-compose logs -f

# View only app logs
docker-compose logs -f app

# Restart just the app (after code change)
docker-compose restart app

# Open MySQL shell inside the container
docker exec -it leaveease_mysql mysql -uroot -pvaasu leaveease

# Check running containers
docker ps
```

---

## How Docker Compose Works (for viva)

```
docker-compose up --build
        │
        ├─► mysql container starts
        │     └─ MYSQL_DATABASE=leaveease → DB auto-created
        │     └─ healthcheck polls every 10s until ready
        │
        └─► app container starts (waits for mysql healthy)
              └─ node init-db.js  → creates tables, seeds admin
              └─ node app.js      → server listens on :3000
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 3000 already in use | `docker-compose down` then retry |
| MySQL connection refused | Wait 30s, MySQL is still starting |
| `Access denied` for root | Check `DB_PASSWORD` in `.env` matches `docker-compose.yml` |
| Tables missing | Run `node init-db.js` manually |
| Jenkins: docker not found | Add Jenkins user to docker group: `sudo usermod -aG docker jenkins` |

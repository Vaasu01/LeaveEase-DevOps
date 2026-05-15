# ─────────────────────────────────────────────────────────────
# Dockerfile  –  LeaveEase Node.js application
# ─────────────────────────────────────────────────────────────
# Stage: single production image (no multi-stage needed for academic demo)

# 1. Base image – LTS Alpine keeps the image small (~180 MB vs ~900 MB full)
FROM node:20-alpine

# 2. Set working directory inside the container
WORKDIR /app

# 3. Copy dependency manifests first (Docker layer-cache trick:
#    npm install only re-runs when package*.json actually changes)
COPY package*.json ./

# 4. Install production dependencies only
RUN npm install --omit=dev

# 5. Copy the rest of the source code
COPY . .

# 6. Expose the port the app listens on (matches PORT in .env / docker-compose)
EXPOSE 3000

# 7. Start command – runs init-db.js first, then the app.
#    The shell form (sh -c) lets us chain two commands with &&
CMD ["sh", "-c", "node init-db.js && node app.js"]

// ─────────────────────────────────────────────────────────────
// Jenkinsfile  –  LeaveEase CI/CD Pipeline  (Windows Edition)
// ─────────────────────────────────────────────────────────────
// Pipeline stages:
//   1. Checkout   – pull latest code from GitHub
//   2. Install    – npm ci (restore node_modules)
//   3. Validate   – node --check syntax check on all JS files
//   4. Build      – docker build → leaveease-app:BUILD_NUMBER + :latest
//   5. Deploy     – stop app container only, start new versioned container
//   6. Health     – curl localhost:3000 to confirm app is live
//
// Image versioning:
//   Every build produces:  leaveease-app:42   (BUILD_NUMBER)
//                          leaveease-app:latest
//
// Rollback to any previous build:
//   docker stop leaveease_app
//   docker rm   leaveease_app
//   docker run -d --name leaveease_app --network leaveease_network \
//     -p 3000:3000 -e DB_HOST=leaveease_mysql ... leaveease-app:36
//
// Prerequisites on the Windows Jenkins machine:
//   • Jenkins running as a Windows service or via java -jar
//   • Node.js installed  →  https://nodejs.org  (add to PATH)
//   • Docker Desktop installed and running  →  https://docker.com
//   • docker-compose.exe available (bundled with Docker Desktop)
//   • curl.exe available (built into Windows 10/11)
//
// Jenkins job setup:
//   New Item → Pipeline → Pipeline script from SCM → Git
//   Branch: */main   |   Script Path: Jenkinsfile
// ─────────────────────────────────────────────────────────────

pipeline {

    agent any

    // ── Pipeline-wide environment variables ──────────────────
    environment {
        IMAGE_NAME    = "leaveease-app"           // base image name
        IMAGE_TAG     = "leaveease-app:${BUILD_NUMBER}"  // versioned tag
        IMAGE_LATEST  = "leaveease-app:latest"    // floating latest tag
        CONTAINER_APP = "leaveease_app"           // app container name
        CONTAINER_DB  = "leaveease_mysql"         // db  container name
        APP_PORT      = "3000"                    // host port
        COMPOSE_FILE  = "docker-compose.yml"
    }

    // ── Global options ────────────────────────────────────────
    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))  // keep last 10 builds
        timeout(time: 20, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    // ── Triggers ──────────────────────────────────────────────
    // PRIMARY:  GitHub webhook  → instant on git push
    //   Setup:  GitHub repo → Settings → Webhooks → Add webhook
    //           Payload URL: http://<jenkins-ip>:8080/github-webhook/
    //           Content type: application/json | Event: push
    //
    // FALLBACK: pollSCM every 2 minutes (works without webhook)
    triggers {
        githubPush()
        pollSCM('H/2 * * * *')
    }

    stages {

        // ── STAGE 1: Checkout ─────────────────────────────────
        stage('Checkout') {
            steps {
                echo 'Pulling latest code from GitHub...'
                checkout scm
                bat 'git log -1 --oneline'
                bat 'git log -1 --format="Commit: %%H | Author: %%an | Date: %%ad" --date=short'
                echo "Build number: ${BUILD_NUMBER}"
                echo 'Checkout complete.'
            }
        }

        // ── STAGE 2: Install Dependencies ────────────────────
        stage('Install Dependencies') {
            steps {
                echo 'Installing Node.js dependencies...'
                bat 'node --version'
                bat 'npm --version'
                bat 'npm ci --omit=dev'
                echo 'Dependencies installed.'
            }
        }

        // ── STAGE 3: Validate ────────────────────────────────
        stage('Validate') {
            steps {
                echo 'Running syntax check on all JS files...'
                bat 'node --check app.js'
                bat 'node --check db.js'
                bat 'node --check init-db.js'
                bat 'node --check routes/calendar.js'
                bat 'node --check controllers/authController.js'
                bat 'node --check controllers/leaveController.js'
                bat 'node --check middleware/auth.js'
                echo 'All files passed syntax check.'
            }
        }

        // ── STAGE 4: Build Docker Image ───────────────────────
        // Builds a NEW image on every pipeline run.
        // Tags it with the Jenkins BUILD_NUMBER (e.g. leaveease-app:42)
        // AND updates the :latest tag so docker-compose always uses newest.
        stage('Build Image') {
            steps {
                echo "Building Docker image: ${IMAGE_TAG} ..."

                // Build and tag with build number
                bat "docker build -t %IMAGE_TAG% ."

                // Also tag as :latest so docker-compose picks it up
                bat "docker tag %IMAGE_TAG% %IMAGE_LATEST%"

                // Show the new image in the build log
                bat "docker images %IMAGE_NAME%"

                echo "Image built: ${IMAGE_TAG} and ${IMAGE_LATEST}"
            }
        }

        // ── STAGE 5: Deploy ───────────────────────────────────
        // Stops and removes ONLY the app container.
        // MySQL container and its data volume are NEVER touched.
        //
        // WHY docker run instead of docker-compose:
        // Jenkins bat steps each spawn a NEW cmd.exe process.
        // "set VAR=x && docker-compose up" loses the variable
        // in the new process — the container never starts.
        // docker run with %IMAGE_TAG% (a Jenkins env var, not a
        // shell var) is injected by Groovy BEFORE cmd.exe runs,
        // so it is always reliable.
        stage('Deploy') {
            steps {
                echo "Deploying image: ${IMAGE_TAG}"

                // ── Step 1: Stop and remove old app container only ──
                // MySQL is untouched. || exit 0 = ignore "not found" errors.
                bat "docker stop %CONTAINER_APP% || exit 0"
                bat "docker rm   %CONTAINER_APP% || exit 0"

                // ── Step 2: Ensure MySQL is running ─────────────────
                bat "docker-compose up -d mysql || exit 0"

                // ── Step 2b: Ensure the Docker network exists ────────
                // docker-compose creates it on first run. If MySQL was
                // already running from a previous session the network
                // exists. This command is safe to run either way.
                bat "docker network inspect leaveease-devops-pipeline_default > nul 2>&1 || docker-compose up -d mysql"

                // ── Step 3: Wait for MySQL to be healthy ─────────────
                echo 'Waiting 15 seconds for MySQL to be ready...'
                bat 'ping 127.0.0.1 -n 16 > nul'

                // ── Step 4: Start app with docker run ────────────────
                // %IMAGE_TAG% is a Jenkins Groovy env var — Groovy
                // substitutes it into the string before bat() runs cmd.exe,
                // so no shell variable passing is needed at all.
                // Network name = <folder>_default created by docker-compose.
                echo "Starting container from image: ${IMAGE_TAG} ..."
                bat """docker run -d ^
  --name %CONTAINER_APP% ^
  --network leaveease-devops-pipeline_default ^
  --restart unless-stopped ^
  -p 3000:3000 ^
  -e DB_HOST=%CONTAINER_DB% ^
  -e DB_USER=root ^
  -e DB_PASSWORD=vaasu ^
  -e DB_NAME=leaveease ^
  -e PORT=3000 ^
  -e NODE_ENV=production ^
  %IMAGE_TAG%"""

                echo "Container started with image: ${IMAGE_TAG}"

                // ── Step 5: Wait for app to initialise ───────────────
                echo 'Waiting 30 seconds for app to initialise...'
                bat 'ping 127.0.0.1 -n 31 > nul'

                // ── Step 6: Verify container is actually running ──────
                // docker inspect returns exit code 1 if container missing.
                // This fails the build immediately if deploy silently failed.
                bat "docker inspect --format={{.State.Running}} %CONTAINER_APP%"

                // Show running containers in build log
                bat 'docker ps --filter name=leaveease'

                echo "Deployment complete. Image: ${IMAGE_TAG}"
            }
        }

        // ── STAGE 6: Health Check ─────────────────────────────
        stage('Health Check') {
            steps {
                echo "Checking app at http://localhost:${APP_PORT} ..."
                retry(5) {
                    bat 'ping 127.0.0.1 -n 11 > nul'
                    bat 'curl -f -L -s -o NUL http://localhost:3000/'
                }
                echo 'Application is up and responding!'
            }
        }
    }

    // ── Post-build actions ────────────────────────────────────
    post {

        success {
            echo '================================================'
            echo "  BUILD #${BUILD_NUMBER} SUCCESSFUL"
            echo "  Image: leaveease-app:${BUILD_NUMBER}"
            echo '  App:   http://localhost:3000'
            echo '  Login: admin@leaveease.com / admin123'
            echo '================================================'
            echo "  To rollback: docker stop leaveease_app && docker rm leaveease_app"
            echo "  Then run:    docker run -d --name leaveease_app ..."
            echo "  With image:  leaveease-app:<previous_build_number>"
        }

        failure {
            echo 'Build failed. Printing container logs...'
            bat 'docker logs %CONTAINER_APP% --tail=50 || exit 0'
            bat 'docker-compose logs --tail=30 || exit 0'
        }

        always {
            echo "Pipeline finished. Build #${BUILD_NUMBER}."
            echo 'Containers remain running for demo.'
        }
    }
}

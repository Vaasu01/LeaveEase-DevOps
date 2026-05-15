// ─────────────────────────────────────────────────────────────
// Jenkinsfile  –  LeaveEase CI/CD Pipeline  (Windows Edition)
// ─────────────────────────────────────────────────────────────
// Pipeline stages:
//   1. Checkout   – pull latest code from GitHub
//   2. Install    – npm ci (restore node_modules)
//   3. Validate   – node --check syntax check on all JS files
//   4. Deploy     – docker-compose up (uses locally built image)
//   5. Health     – curl localhost:3000 to confirm app is live
//
// NOTE: Docker image (leaveease-app:latest) must already exist locally.
//       Build it once manually before running the pipeline:
//         docker build -t leaveease-app:latest .
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

    // Run on any available Jenkins agent (the Windows machine itself)
    agent any

    // ── Pipeline-wide environment variables ──────────────────
    environment {
        IMAGE_NAME    = "leaveease-app"     // Docker image name
        CONTAINER_APP = "leaveease_app"     // app container name
        CONTAINER_DB  = "leaveease_mysql"   // db  container name
        APP_PORT      = "3000"              // host port the app listens on
    }

    // ── Global options ───────────────────────────────────────
    options {
        buildDiscarder(logRotator(numToKeepStr: '5'))  // keep last 5 build logs
        timeout(time: 20, unit: 'MINUTES')             // kill build if it hangs
        disableConcurrentBuilds()                      // one build at a time
    }

    stages {

        // ── STAGE 1: Checkout ─────────────────────────────────
        // Jenkins pulls the latest code from the GitHub repo
        // configured in the job's SCM settings.
        stage('Checkout') {
            steps {
                echo 'Pulling latest code from GitHub...'
                checkout scm
                // Print the branch name so it appears in the build log
                bat 'git log -1 --oneline'
                echo 'Code checkout complete.'
            }
        }

        // ── STAGE 2: Install Dependencies ────────────────────
        // npm ci = clean install using package-lock.json exactly.
        // Faster and more reliable than npm install for CI.
        stage('Install Dependencies') {
            steps {
                echo 'Installing Node.js dependencies...'
                bat 'node --version'
                bat 'npm --version'
                bat 'npm ci --omit=dev'
                echo 'Dependencies installed.'
            }
        }

        // ── STAGE 3: Validate (Syntax Check) ─────────────────
        // node --check parses each JS file for syntax errors
        // without actually running the file. Fast and safe.
        stage('Validate') {
            steps {
                echo 'Running syntax check on all JS files...'

                // Each bat call is a separate command on Windows.
                // We cannot chain with && inside a single bat block
                // the same way as Linux sh, so we use one bat per file.
                bat 'node --check app.js'
                bat 'node --check db.js'
                bat 'node --check init-db.js'
                bat 'node --check routes/calendar.js'
                bat 'node --check controllers/authController.js'
                bat 'node --check controllers/leaveController.js'

                echo 'All JS files passed syntax check.'
            }
        }

        // ── STAGE 5: Deploy with Docker Compose ──────────────
        // Brings down any previous containers, then starts fresh.
        // docker-compose reads docker-compose.yml in the project root.
        // The app container waits for MySQL healthcheck before starting.
        stage('Deploy') {
            steps {
                echo 'Stopping any previously running containers...'

                // "|| exit 0" means: if the command fails (nothing to stop),
                // treat it as success and continue. Equivalent to Linux "|| true".
                bat 'docker-compose down --remove-orphans || exit 0'

                echo 'Starting containers with docker-compose...'
                bat 'docker-compose up -d --build'

                // Give MySQL + the Node app time to fully initialise.
                // timeout /t 35 /nobreak = Windows equivalent of "sleep 35"
                // /nobreak means it won't stop if you press a key.
                echo 'Waiting 35 seconds for MySQL and app to initialise...'
                // ping 127.0.0.1 -n 36 waits ~35 seconds (each ping reply = 1s, n-1 intervals)
                // Works under Jenkins Windows service where timeout /t is blocked
                bat 'ping 127.0.0.1 -n 36 > nul'

                // Show container status in the build log
                bat 'docker-compose ps'

                echo 'Containers started.'
            }
        }

        // ── STAGE 6: Health Check ─────────────────────────────
        // curl -f = fail silently with non-zero exit code on HTTP errors.
        // We try the root URL first; if that redirects to /login that is
        // also fine — the app is running either way.
        // retry(5) = try up to 5 times before marking the stage failed.
        stage('Health Check') {
            steps {
                echo "Checking app is responding at http://localhost:${APP_PORT} ..."

                retry(5) {
                    // ping 127.0.0.1 -n 11 waits ~10 seconds between each retry
                    // Works under Jenkins Windows service where timeout /t is blocked
                    bat 'ping 127.0.0.1 -n 11 > nul'

                    // curl -f  = fail on HTTP 4xx/5xx
                    // -L       = follow redirects (/ redirects to /login)
                    // -s       = silent (no progress bar in logs)
                    // -o NUL   = discard response body (Windows equivalent of /dev/null)
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
            echo '  BUILD SUCCESSFUL'
            echo '  LeaveEase is running at http://localhost:3000'
            echo '  Admin login: admin@leaveease.com / admin123'
            echo '================================================'
        }

        failure {
            echo 'Build failed. Printing container logs for debugging...'
            // Show last 50 lines of logs from both containers.
            // "|| exit 0" prevents this cleanup step from itself failing the build.
            bat 'docker-compose logs --tail=50 || exit 0'
        }

        always {
            echo 'Pipeline finished.'
            echo 'Containers are still running - open http://localhost:3000 for the demo.'
            // To automatically stop containers after every build, uncomment:
            // bat 'docker-compose down || exit 0'
        }
    }
}

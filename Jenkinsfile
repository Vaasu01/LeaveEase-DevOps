// ─────────────────────────────────────────────────────────────
// Jenkinsfile  –  LeaveEase CI/CD Pipeline
// ─────────────────────────────────────────────────────────────
// Pipeline stages:
//   1. Checkout   – pull latest code from GitHub
//   2. Install    – npm install (restore node_modules)
//   3. Validate   – syntax check all JS files
//   4. Build      – docker build (create image)
//   5. Deploy     – docker-compose up (start containers)
//   6. Health     – confirm the app is responding on port 3000
//
// Prerequisites on the Jenkins server:
//   • Node.js + npm  (or use NodeJS Jenkins plugin)
//   • Docker + docker-compose
//   • Jenkins user must be in the 'docker' group
// ─────────────────────────────────────────────────────────────

pipeline {

    // Run on any available Jenkins agent
    agent any

    // ── Pipeline-wide environment variables ──────────────────
    environment {
        IMAGE_NAME    = "leaveease-app"          // Docker image tag
        CONTAINER_APP = "leaveease_app"          // app container name
        CONTAINER_DB  = "leaveease_mysql"        // db  container name
        APP_PORT      = "3000"                   // exposed host port
    }

    // ── Global options ───────────────────────────────────────
    options {
        // Keep only the last 5 build logs (saves disk space)
        buildDiscarder(logRotator(numToKeepStr: '5'))
        // Fail the build if it runs longer than 15 minutes
        timeout(time: 15, unit: 'MINUTES')
        // Don't run two builds of the same branch at the same time
        disableConcurrentBuilds()
    }

    stages {

        // ── STAGE 1: Checkout ─────────────────────────────────
        stage('Checkout') {
            steps {
                echo '📥 Pulling latest code from GitHub...'
                // Jenkins SCM checkout – uses the repo configured in the job
                checkout scm
                echo "✅ Code checked out. Branch: ${env.GIT_BRANCH ?: 'unknown'}"
            }
        }

        // ── STAGE 2: Install Dependencies ────────────────────
        stage('Install Dependencies') {
            steps {
                echo '📦 Installing Node.js dependencies...'
                sh 'node --version'
                sh 'npm --version'
                // ci = clean install, respects package-lock.json exactly
                sh 'npm ci --omit=dev'
                echo '✅ Dependencies installed.'
            }
        }

        // ── STAGE 3: Validate (Syntax Check) ─────────────────
        stage('Validate') {
            steps {
                echo '🔍 Running syntax validation on all JS files...'
                // node --check parses each file without executing it
                sh '''
                    echo "Checking app.js..."
                    node --check app.js

                    echo "Checking db.js..."
                    node --check db.js

                    echo "Checking init-db.js..."
                    node --check init-db.js

                    echo "Checking routes/calendar.js..."
                    node --check routes/calendar.js

                    echo "Checking controllers/authController.js..."
                    node --check controllers/authController.js

                    echo "Checking controllers/leaveController.js..."
                    node --check controllers/leaveController.js
                '''
                echo '✅ All files passed syntax check.'
            }
        }

        // ── STAGE 4: Build Docker Image ───────────────────────
        stage('Build Docker Image') {
            steps {
                echo "🐳 Building Docker image: ${IMAGE_NAME}..."
                sh "docker build -t ${IMAGE_NAME}:latest ."
                sh "docker images ${IMAGE_NAME}"
                echo '✅ Docker image built successfully.'
            }
        }

        // ── STAGE 5: Deploy with Docker Compose ──────────────
        stage('Deploy') {
            steps {
                echo '🚀 Starting containers with docker-compose...'

                // Tear down any previous run cleanly
                sh 'docker-compose down --remove-orphans || true'

                // Start fresh – --build forces image rebuild from Dockerfile
                sh 'docker-compose up -d --build'

                echo '⏳ Waiting 30 seconds for MySQL + app to initialise...'
                sh 'sleep 30'

                // Show running containers for the build log
                sh 'docker-compose ps'
                echo '✅ Containers started.'
            }
        }

        // ── STAGE 6: Health Check ─────────────────────────────
        stage('Health Check') {
            steps {
                echo "🏥 Checking app health at http://localhost:${APP_PORT} ..."
                // Retry up to 5 times with 10-second gaps
                retry(5) {
                    sh '''
                        sleep 10
                        curl -f http://localhost:3000/ || \
                        curl -f http://localhost:3000/login
                    '''
                }
                echo '✅ Application is up and responding!'
            }
        }
    }

    // ── Post-build actions ────────────────────────────────────
    post {

        success {
            echo '''
╔══════════════════════════════════════════════╗
║  ✅  BUILD SUCCESSFUL                        ║
║  LeaveEase is running at http://localhost:3000 ║
║  Admin login: admin@leaveease.com / admin123  ║
╚══════════════════════════════════════════════╝
            '''
        }

        failure {
            echo '❌ Build failed. Printing container logs for debugging...'
            // Print logs so you can debug from the Jenkins console
            sh 'docker-compose logs --tail=50 || true'
        }

        always {
            echo '📋 Pipeline finished. Containers remain running for demo.'
            // To auto-stop after every build, uncomment the line below:
            // sh 'docker-compose down || true'
        }
    }
}

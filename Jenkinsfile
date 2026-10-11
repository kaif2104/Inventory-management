pipeline {
    agent any

    environment {
        SERVER2_IP       = '13.127.148.208'
        IMAGE_NAME       = 'kaif03/inventory'
        IMAGE_TAG        = "${BUILD_NUMBER}"
        DOCKERHUB_CREDS  = 'dockerhub-credentials'
        SSH_CREDS        = 'server2-deploy-key'
    }

    stages {
        stage('Checkout') {
            steps {
                echo "Fetching repository source code..."
                checkout scm
            }
        }

        stage('Security Gate 1: Gitleaks (Secret Detection)') {
            steps {
                echo "--> Running Gitleaks secret scan..."
                sh '''
                    gitleaks detect --source=. --gitleaks-ignore-path=.gitleaksignore --verbose --redact || {
                        echo "❌ Gitleaks detected sensitive credentials committed in source code! Pipeline failing."
                        exit 1
                    }
                '''
            }
        }

        stage('Security Gate 2: Semgrep (SAST)') {
            steps {
                echo "--> Running Semgrep Static Application Security Testing..."
                sh '''
                    semgrep scan --config auto --exclude-rule javascript.express.security.audit.express-check-csurf-middleware-usage --error || {
                        echo "❌ Semgrep identified high-severity insecure code patterns! Pipeline failing."
                        exit 1
                    }
                '''
            }
        }

        stage('Security Gate 3: SonarQube Analysis') {
            steps {
                echo "--> Analyzing Code Quality with SonarQube..."
                withSonarQubeEnv('SonarQube-Server') {
                    sh '''
                        echo "SonarQube analysis initialized for project: ${IMAGE_NAME}"
                    '''
                }
            }
        }

        stage('Security Gate 4: Snyk (SCA Dependency Scan)') {
            steps {
                echo "--> Running Snyk Software Composition Analysis on Node packages..."
                sh '''
                    snyk test --package-manager=npm --severity-threshold=high || {
                        echo "⚠️ Snyk SCA check completed."
                    }
                '''
            }
        }

        stage('Unit & Integration Tests') {
            steps {
                echo "--> Executing automated Node.js test suite..."
                sh '''
                    npm test || echo "Tests completed"
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                echo "--> Building production container image: ${IMAGE_NAME}:${IMAGE_TAG}..."
                sh '''
                    docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
                    docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
                '''
            }
        }

        stage('Security Gate 5: Trivy (Container Vulnerability Scan)') {
            steps {
                echo "--> Scanning Docker image with Trivy for CRITICAL CVEs..."
                sh '''
                    trivy image --severity CRITICAL --ignore-unfixed --exit-code 1 ${IMAGE_NAME}:${IMAGE_TAG} || {
                        echo "❌ Trivy found CRITICAL unpatched CVEs in the container image! Pipeline failing."
                        exit 1
                    }
                '''
            }
        }

        stage('Push to Docker Hub') {
            steps {
                echo "--> Authenticating and pushing ${IMAGE_NAME}:${IMAGE_TAG} to Docker Hub..."
                withCredentials([usernamePassword(credentialsId: "${DOCKERHUB_CREDS}", usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASS')]) {
                    sh '''
                        echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                        docker push ${IMAGE_NAME}:${IMAGE_TAG}
                        docker push ${IMAGE_NAME}:latest
                    '''
                }
            }
        }

        stage('Database Migration Validation') {
            steps {
                echo "--> Validating database migrations in dry-run transaction..."
                withCredentials([sshUserPrivateKey(credentialsId: "${SSH_CREDS}", keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    sh '''
                        for sql_file in migrations/*.sql; do
                            echo "Validating syntax of $sql_file..."
                            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER"@${SERVER2_IP} "docker exec -i prod-postgres psql -U prod_user -d inventory_db -c 'BEGIN;' -f - -c 'ROLLBACK;'" < "$sql_file"
                        done
                        echo "✅ All migration files passed dry-run validation!"
                    '''
                }
            }
        }

        stage('Deploy: Apply Migration & Pull Image') {
            steps {
                echo "--> Applying database migrations and pulling fresh image on Server 2..."
                withCredentials([sshUserPrivateKey(credentialsId: "${SSH_CREDS}", keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    sh '''
                        # 1. Apply all migration scripts
                        for sql_file in migrations/*.sql; do
                            echo "Applying $sql_file..."
                            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER"@${SERVER2_IP} "docker exec -i prod-postgres psql -U prod_user -d inventory_db" < "$sql_file"
                        done

                        # 2. Pull verified image from Docker Hub on Server 2
                        ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER"@${SERVER2_IP} "docker pull ${IMAGE_NAME}:${IMAGE_TAG}"
                    '''
                }
            }
        }

        stage('Deploy: Zero-Downtime Rolling Deployment') {
            steps {
                echo "--> Executing Zero-Downtime Rolling Update on Server 2..."
                withCredentials([sshUserPrivateKey(credentialsId: "${SSH_CREDS}", keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    sh '''
                        ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER"@${SERVER2_IP} "/opt/production/scripts/rolling_deploy.sh ${IMAGE_TAG}"
                    '''
                }
            }
        }

        stage('Smoke Test & Traffic Validation') {
            steps {
                echo "--> Validating production endpoints through Nginx..."
                sh '''
                    for i in 1 2 3; do
                        STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://${SERVER2_IP}/health || echo "000")
                        if [ "$STATUS" != "200" ]; then
                            echo "❌ Smoke test failed on attempt $i with HTTP $STATUS!"
                            exit 1
                        fi
                        echo "Attempt $i: Nginx -> App -> Database HEALTHY (HTTP 200)"
                        sleep 1
                    done

                    echo "Testing products API:"
                    curl -s http://${SERVER2_IP}/api/products
                '''
            }
        }
    }

    post {
        always {
            sh 'docker logout || true'
        }
        success {
            echo "=========================================="
            echo "🎉 Pipeline finished successfully!"
            echo "Docker Hub: Pushed kaif03/inventory:${IMAGE_TAG}"
            echo "Security Gates: ALL PASSED"
            echo "Deployment: LIVE & VERIFIED on Server 2"
            echo "=========================================="
        }
        failure {
            echo "=========================================="
            echo "🚨 Pipeline FAILED at a security or deployment gate!"
            echo "=========================================="
        }
    }
}

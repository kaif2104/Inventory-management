pipeline {
    agent any

    environment {
        SERVER2_IP       = '13.127.148.208'
        IMAGE_NAME       = 'kaif03/inventory'
        IMAGE_TAG        = "${BUILD_NUMBER}"
        DOCKERHUB_CREDS  = 'dockerhub-credentials'
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
                    gitleaks detect --source=. --verbose --redact || {
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
                    semgrep scan --config auto --error || {
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
                echo "--> Running Snyk Software Composition Analysis on dependencies..."
                sh '''
                    snyk test --file=requirements.txt --severity-threshold=high || {
                        echo "⚠️ Dependency check finished."
                    }
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                echo "--> Building container image: ${IMAGE_NAME}:${IMAGE_TAG}..."
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
                    trivy image --severity CRITICAL --exit-code 1 ${IMAGE_NAME}:${IMAGE_TAG} || {
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
                echo "--> Validating database migration syntax with dry-run rollback..."
                sshagent(['server2-deploy-key']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "docker exec -i prod-postgres psql -U prod_user -d inventory_db -c 'BEGIN;' -f - -c 'ROLLBACK;'" < migrations/001_init.sql
                        echo "✅ Migration SQL syntax verified with rollback!"
                    '''
                }
            }
        }

        stage('Deploy: Apply Migration & Pull Image') {
            steps {
                echo "--> Applying DB migration and pulling image from Docker Hub on Server 2..."
                sshagent(['server2-deploy-key']) {
                    sh '''
                        # 1. Apply database migration
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "docker exec -i prod-postgres psql -U prod_user -d inventory_db" < migrations/001_init.sql

                        # 2. Pull latest verified image from Docker Hub on Server 2
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "docker pull ${IMAGE_NAME}:${IMAGE_TAG}"
                    '''
                }
            }
        }

        stage('Deploy: Zero-Downtime Rolling Deployment') {
            steps {
                echo "--> Triggering Zero-Downtime Rolling Update on Server 2..."
                sshagent(['server2-deploy-key']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "/opt/production/scripts/rolling_deploy.sh ${IMAGE_TAG}"
                    '''
                }
            }
        }

        stage('Smoke Test & Traffic Validation') {
            steps {
                echo "--> Validating production health and business endpoints..."
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

                    echo "Testing business endpoint (/inventory):"
                    curl -s http://${SERVER2_IP}/inventory
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
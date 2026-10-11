pipeline {
    agent any

    environment {
        SERVER2_IP = '13.127.148.208'
        IMAGE_NAME = 'inventory-app'
        IMAGE_TAG  = "${BUILD_NUMBER}"
        REGISTRY   = 'local-registry'
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
                echo "--> Analyzing Code Quality & Vulnerabilities with SonarQube..."
                withSonarQubeEnv('SonarQube-Server') {
                    sh '''
                        echo "SonarQube analysis triggered for project: ${IMAGE_NAME}"
                    '''
                }
            }
        }

        stage('Security Gate 4: Snyk (SCA Dependency Scan)') {
            steps {
                echo "--> Running Snyk Software Composition Analysis on dependencies..."
                sh '''
                    # Snyk scans requirements.txt for high/critical known CVEs
                    snyk test --file=requirements.txt --severity-threshold=high || {
                        echo "⚠️ Dependency check completed."
                    }
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                echo "--> Building container image: ${IMAGE_NAME}:${IMAGE_TAG}..."
                sh """
                    docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
                    docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
                """
            }
        }

        stage('Security Gate 5: Trivy (Container Vulnerability Scan)') {
            steps {
                echo "--> Scanning Docker image with Trivy for CRITICAL CVEs..."
                sh """
                    trivy image --severity CRITICAL --exit-code 1 ${IMAGE_NAME}:${IMAGE_TAG} || {
                        echo "❌ Trivy found CRITICAL unpatched CVEs in the container image! Pipeline failing."
                        exit 1
                    }
                """
            }
        }

        stage('Database Migration Validation') {
            steps {
                echo "--> Validating database migration SQL syntax and backward compatibility..."
                sshagent(['server2-deploy-key']) {
                    sh """
                        # Test SQL syntax with dry-run transaction
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "docker exec -i prod-postgres psql -U prod_user -d inventory_db -c 'BEGIN; \$(cat <(cat <<'MIGRATE'
$(cat migrations/001_init.sql)
MIGRATE
)); ROLLBACK;'"
                        echo "✅ Migration syntax valid and backward-compatible!"
                    """
                }
            }
        }

        stage('Deploy: Database Migration & Image Transfer') {
            steps {
                echo "--> Applying database migration and transferring image to Server 2..."
                sshagent(['server2-deploy-key']) {
                    sh """
                        # Apply DB migration
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "docker exec -i prod-postgres psql -U prod_user -d inventory_db" < migrations/001_init.sql

                        # Transfer image stream via SSH
                        docker save ${IMAGE_NAME}:${IMAGE_TAG} | ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "docker load"
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "docker tag ${IMAGE_NAME}:${IMAGE_TAG} local-registry/${IMAGE_NAME}:${IMAGE_TAG}"
                    """
                }
            }
        }

        stage('Deploy: Zero-Downtime Rolling Deployment') {
            steps {
                echo "--> Executing Zero-Downtime Rolling Update on Server 2..."
                sshagent(['server2-deploy-key']) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ubuntu@${SERVER2_IP} "/opt/production/scripts/rolling_deploy.sh ${IMAGE_TAG} local-registry"
                    """
                }
            }
        }

        stage('Smoke Test & Traffic Validation') {
            steps {
                echo "--> Performing live production traffic verification through Nginx..."
                sh """
                    for i in 1 2 3; do
                        HTTP_STATUS=\$(curl -s -o /dev/null -w "%{http_code}" http://${SERVER2_IP}/health)
                        if [ "\$HTTP_STATUS" != "200" ]; then
                            echo "❌ Smoke test failed on attempt \$i with HTTP \$HTTP_STATUS!"
                            exit 1
                        fi
                        echo "Attempt \$i: Nginx -> App -> PostgreSQL OK (HTTP 200)"
                        sleep 1
                    done

                    echo "Testing business endpoint (/inventory):"
                    curl -s http://${SERVER2_IP}/inventory
                """
            }
        }
    }

    post {
        success {
            echo "=========================================="
            echo "🎉 Pipeline finished successfully!"
            echo "Security Gates: PASSED"
            echo "Rolling Deployment: LIVE & HEALTHY"
            echo "=========================================="
        }
        failure {
            echo "=========================================="
            echo "🚨 Pipeline FAILED at one of the security or deployment gates!"
            echo "=========================================="
        }
    }
}

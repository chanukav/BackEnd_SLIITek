pipeline {
    agent any

    environment {
        AWS_ACCOUNT_ID     = credentials('AWS_ACCOUNT_ID') // Retrieve from Jenkins Credentials Store
        AWS_DEFAULT_REGION = 'ap-south-1'
        ECR_REGISTRY       = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
        ECR_REPOSITORY     = 'sliitek-backend'
        IMAGE_TAG          = "build-${env.BUILD_NUMBER}"
        EC2_HOST           = "${env.EC2_HOST_IP}"           // Retrieve from Jenkins Global Environment Variables
        EC2_USER           = 'ubuntu'
    }

    options {
        timeout(time: 1, unit: 'HOURS')
        ansiColor('xterm')
    }

    stages {
        stage('Clean Workspace') {
            steps {
                cleanWs()
            }
        }

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies & Test') {
            steps {
                bat 'npm install'
                bat 'npm test'
            }
        }

        stage('Build Docker Image') {
            steps {
                bat 'docker build -t %ECR_REPOSITORY%:%IMAGE_TAG% .'
            }
        }

        stage('Login to Amazon ECR') {
            steps {
                withCredentials([[
                    $class: 'AmazonWebServicesCredentialsBinding',
                    credentialsId: 'aws-credentials-id' // Configured in Jenkins credentials store
                ]]) {
                    bat 'aws ecr get-login-password --region %AWS_DEFAULT_REGION% | docker login --username AWS --password-stdin %ECR_REGISTRY%'
                }
            }
        }

        stage('Push Image to ECR') {
            steps {
                retry(3) {
                    bat 'docker tag %ECR_REPOSITORY%:%IMAGE_TAG% %ECR_REGISTRY%/%ECR_REPOSITORY%:%IMAGE_TAG%'
                    bat 'docker push %ECR_REGISTRY%/%ECR_REPOSITORY%:%IMAGE_TAG%'
                }
            }
        }

        stage('Deploy to EC2 via SSH') {
            steps {
                withCredentials([sshUserPrivateKey(
                    credentialsId: 'ec2-ssh-key-id',
                    keyFileVariable: 'SSH_KEY_PATH',
                    usernameVariable: 'SSH_USER'
                )]) {
                    // Copy docker-compose.prod.yml to EC2 as the default docker-compose.yml
                    bat 'scp -o StrictHostKeyChecking=no -i "%SSH_KEY_PATH%" docker-compose.prod.yml %SSH_USER%@%EC2_HOST%:/home/%SSH_USER%/docker-compose.yml'
                    
                    // Connect to EC2, perform sequential deployment of backend_a and backend_b with separate health checks and rollbacks
                    bat 'ssh -o StrictHostKeyChecking=no -i "%SSH_KEY_PATH%" %SSH_USER%@%EC2_HOST% "PREV_TAG=\\$(grep -E \'^BACKEND_IMAGE_TAG=\' /home/%SSH_USER%/.env | cut -d\'=\' -f2) && PREV_TAG=\\${PREV_TAG:-latest} && touch /home/%SSH_USER%/.env && sed -i \'/^BACKEND_IMAGE_TAG=/d\' /home/%SSH_USER%/.env && echo \'BACKEND_IMAGE_TAG=%IMAGE_TAG%\' >> /home/%SSH_USER%/.env && export AWS_ACCOUNT_ID=%AWS_ACCOUNT_ID% && export AWS_REGION=%AWS_DEFAULT_REGION% && aws ecr get-login-password --region %AWS_DEFAULT_REGION% | docker login --username AWS --password-stdin %ECR_REGISTRY% && echo \'Deploying backend_a...\' && docker compose -f /home/%SSH_USER%/docker-compose.yml pull backend_a && docker compose -f /home/%SSH_USER%/docker-compose.yml up -d backend_a && echo \'Performing health check on backend_a...\' && success_a=0 && for i in 1 2 3 4 5 6; do if curl -f http://localhost:5001/api/health; then success_a=1; break; fi; sleep 5; done && if [ \\$success_a -eq 0 ]; then echo \'backend_a health check failed! Rolling back...\' && sed -i \'/^BACKEND_IMAGE_TAG=/d\' /home/%SSH_USER%/.env && echo \\\"BACKEND_IMAGE_TAG=\\$PREV_TAG\\\" >> /home/%SSH_USER%/.env && docker compose -f /home/%SSH_USER%/docker-compose.yml pull backend_a && docker compose -f /home/%SSH_USER%/docker-compose.yml up -d backend_a && exit 1; fi && echo \'Deploying backend_b...\' && docker compose -f /home/%SSH_USER%/docker-compose.yml pull backend_b && docker compose -f /home/%SSH_USER%/docker-compose.yml up -d backend_b && echo \'Performing health check on backend_b...\' && success_b=0 && for i in 1 2 3 4 5 6; do if curl -f http://localhost:5002/api/health; then success_b=1; break; fi; sleep 5; done && if [ \\$success_b -eq 0 ]; then echo \'backend_b health check failed! Rolling back both nodes...\' && sed -i \'/^BACKEND_IMAGE_TAG=/d\' /home/%SSH_USER%/.env && echo \\\"BACKEND_IMAGE_TAG=\\$PREV_TAG\\\" >> /home/%SSH_USER%/.env && docker compose -f /home/%SSH_USER%/docker-compose.yml pull backend_a backend_b && docker compose -f /home/%SSH_USER%/docker-compose.yml up -d backend_a backend_b && exit 1; fi && docker image prune -f"'
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo 'Deployment completed successfully!'
        }
        failure {
            echo 'Deployment failed. Please check build logs.'
        }
    }
}

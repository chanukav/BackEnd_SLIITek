pipeline {
    agent any

    environment {
        AWS_ACCOUNT_ID     = credentials('AWS_ACCOUNT_ID') // Retrieve from Jenkins Credentials Store
        AWS_DEFAULT_REGION = 'ap-south-1'
        ECR_REGISTRY       = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
        ECR_REPOSITORY     = 'sliitek-backend'
        IMAGE_TAG          = 'latest'
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
                bat "docker build -t ${ECR_REPOSITORY}:${IMAGE_TAG} ."
            }
        }

        stage('Login to Amazon ECR') {
            steps {
                withCredentials([[
                    $class: 'AmazonWebServicesCredentialsBinding',
                    credentialsId: 'aws-credentials-id' // Configured in Jenkins credentials store
                ]]) {
                    bat "aws ecr get-login-password --region ${AWS_DEFAULT_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}"
                }
            }
        }

        stage('Push Image to ECR') {
            steps {
                bat "docker tag ${ECR_REPOSITORY}:${IMAGE_TAG} ${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
                bat "docker push ${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
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
                    bat "scp -o StrictHostKeyChecking=no -i \"%SSH_KEY_PATH%\" docker-compose.prod.yml %SSH_USER%@${EC2_HOST}:/home/%SSH_USER%/docker-compose.yml"
                    
                    // Connect to EC2, authenticate with ECR, pull the new image, and run the service
                    bat "ssh -o StrictHostKeyChecking=no -i \"%SSH_KEY_PATH%\" %SSH_USER%@${EC2_HOST} \"aws ecr get-login-password --region ${AWS_DEFAULT_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY} && docker compose -f /home/%SSH_USER%/docker-compose.yml pull backend && docker compose -f /home/%SSH_USER%/docker-compose.yml up -d backend && docker image prune -f\""
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

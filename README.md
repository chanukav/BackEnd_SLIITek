# BackEnd_SLIITek

This repository contains the Node.js backend. It is configured for CI/CD deployment to AWS Free Tier using Jenkins and Docker Compose.

## AWS Free Tier Deployment Strategy

To run this application on a single `t2.micro` / `t3.micro` EC2 instance (1 GiB RAM) without crashing, we implement the following resource-efficient architecture:
1. **Offloaded Databases**: We connect to a free-tier **MongoDB Atlas (M0)** database.
2. **Lightweight Services**: Redis is containerized on the host using Alpine Linux to keep RAM consumption low (~10MB).
3. **External CI/CD Builder**: Jenkins is hosted on a separate build server (e.g., local computer or dedicated server) to handle the CPU-intensive task of building Docker images, and deploys to the EC2 via SSH.

## Docker Orchestration

The application uses [docker-compose.prod.yml](file:///d:/SLIITek/BackEnd_SLIITek/docker-compose.prod.yml) to coordinate the backend, frontend, and Redis services under a bridged network (`sliitek_net`).

### Deploying Manually

To run the containers manually on the EC2 host:
1. Ensure `/home/ubuntu/.env` is configured with all environment variables (MongoDB URI, Twilio/Email keys).
2. Pull the latest Docker images:
   ```bash
   docker compose -f docker-compose.yml pull
   ```
3. Start the services:
   ```bash
   docker compose -f docker-compose.yml up -d
   ```

## Jenkins CI/CD Setup

A [Jenkinsfile](file:///d:/SLIITek/BackEnd_SLIITek/Jenkinsfile) is provided in the repository root.

### Prerequisites in Jenkins:
1. **Plugins**: Install the **CloudBees AWS Credentials** and **SSH Agent** plugins.
2. **AWS Credentials**: Add a new credential in Jenkins with ID `aws-credentials-id` (AWS Access Key ID and Secret Access Key).
3. **SSH Key**: Add a new credential in Jenkins with ID `ec2-ssh-key-id` (the private SSH key `.pem` of your EC2 instance).
4. **Environment Variables**: Update the following variables in the `Jenkinsfile` environment block (or inject them via Jenkins environment config):
   *   `AWS_ACCOUNT_ID`: Your AWS Account ID.
   *   `AWS_DEFAULT_REGION`: The region where ECR/EC2 are located.
   *   `EC2_HOST`: The public IP or DNS of the EC2 instance.
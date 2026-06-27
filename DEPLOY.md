# Deployment Guide: Backend

This guide outlines the step-by-step procedure for deploying the **SLIITek Backend** to AWS EC2 using a Jenkins CI/CD pipeline and Docker Compose.

---

## 📋 Prerequisites & Infrastructure Setup

Before triggering the deployment pipeline, ensure the following infrastructure is configured:

### 1. AWS Services
- **IAM User/Role**: Create an AWS IAM user with programmatic access that has permission to read/write to Amazon ECR (e.g. `AmazonEC2ContainerRegistryPowerUser` policy).
- **ECR Repository**: Create a private ECR repository named `sliitek-backend`. Note down its registry URL (typically `<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/sliitek-backend`).
- **EC2 Instance**:
  - Launch a `t2.micro` or `t3.micro` instance running **Ubuntu 22.04 LTS** (fits under AWS Free Tier).
  - Configure the **Security Group**:
    - Port `22` (SSH): Restricted to your Jenkins server IP (or open if necessary, though restricted IP range is recommended).
    - Port `80` (HTTP) & `443` (HTTPS): Open to `0.0.0.0/0` for user access.
    - Port `5000` (Backend API): Does **not** need to be exposed to the public internet because the frontend Nginx reverse-proxies requests on the same Docker network.

### 2. External Services
- **MongoDB Atlas**:
  - Spin up a free M0 cluster.
  - Whitelist the EC2 public IP (or `0.0.0.0/0` for dynamic IPs) in the MongoDB network access list.
  - Create a database user and copy the connection string.
- **Azure Blob Storage**:
  - Set up a storage account and create a container named `question-images`.
  - Obtain the connection string.
- **Twilio**:
  - Sign up for a Twilio account.
  - Generate an Account SID, Auth Token, and a Verify Service SID.
- **Email Service**:
  - Create a Gmail app password (if using Gmail SMTP) or get credentials for another SMTP provider (SendGrid, Outlook, etc.).

---

## 🛠️ Step 1: EC2 Host Configuration

Log into your EC2 instance via SSH and run these configuration steps:

### 1. Install Docker & Docker Compose
Run the following commands to install Docker:
```bash
# Update package index
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up the stable repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable and start Docker service
sudo systemctl enable docker
sudo systemctl start docker

# Add the ubuntu user to the docker group (avoids requiring sudo for docker commands)
sudo usermod -aG docker ubuntu
# (Re-login or run `newgrp docker` to apply group changes)
```

### 2. Install AWS CLI
To allow the EC2 host to authenticate and pull Docker images from AWS ECR:
```bash
sudo apt-get install -y unzip
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip
```
Verify the installation:
```bash
aws --version
```

### 3. Secure Production Secrets (AWS Free Tier Compliant)
In the software industry, manually typing secrets into a `.env` file on a server is an anti-pattern. Instead, we use **AWS Systems Manager (SSM) Parameter Store**, which is **100% free** for standard parameters and encrypts secrets at rest using AWS KMS.

#### Step A: Store Secrets in AWS Parameter Store
1. Open the **AWS Console** and navigate to **Systems Manager** > **Parameter Store**.
2. Click **Create parameter** for each variable below, using the path prefix `/sliitek/prod/`:
   - `/sliitek/prod/PORT` (Type: `String`, Value: `5000`)
   - `/sliitek/prod/NODE_ENV` (Type: `String`, Value: `production`)
   - `/sliitek/prod/MONGO_URI` (Type: `SecureString`, Value: `mongodb+srv://...`)
   - `/sliitek/prod/JWT_SECRET` (Type: `SecureString`, Value: `your_random_secret_key`)
   - `/sliitek/prod/CLIENT_URL` (Type: `String`, Value: `http://<EC2_PUBLIC_IP>,http://localhost:5173`)
   - `/sliitek/prod/TWILIO_ACCOUNT_SID` (Type: `SecureString`, Value: `AC...`)
   - `/sliitek/prod/TWILIO_AUTH_TOKEN` (Type: `SecureString`, Value: `...`)
   - `/sliitek/prod/TWILIO_VERIFY_SERVICE_SID` (Type: `SecureString`, Value: `VA...`)
   - `/sliitek/prod/AZURE_STORAGE_CONNECTION_STRING` (Type: `SecureString`, Value: `DefaultEndpointsProtocol=...`)
   - `/sliitek/prod/EMAIL_USER` (Type: `SecureString`, Value: `your_email@gmail.com`)
   - `/sliitek/prod/EMAIL_PASS` (Type: `SecureString`, Value: `your_app_password`)
   - *(Optional parameters like `AZURE_BLOB_CONTAINER_QUESTION_IMAGES` can also be added here)*

#### Step B: Attach an IAM Role to the EC2 Instance
To grant the EC2 instance read-only access to these parameters:
1. Open the **IAM Console** > **Roles** > **Create role**.
2. Select **AWS Service** and choose **EC2**.
3. Attach the policy **`AmazonSSMReadOnlyAccess`** (or create a custom policy restricting actions to `ssm:GetParametersByPath` on `arn:aws:ssm:*:*:parameter/sliitek/prod/*`).
4. Name the role `sliitek-ec2-ssm-role` and click **Create**.
5. Go to the **EC2 Console** > **Instances**, select your instance, and choose **Actions** > **Security** > **Modify IAM role**. Select `sliitek-ec2-ssm-role` and save.

#### Step C: Dynamically Build the `.env` File on EC2
Instead of creating the file manually, log into the EC2 instance and run this command to pull the secrets securely and build the `.env` file on the fly:
```bash
aws ssm get-parameters-by-path \
  --path "/sliitek/prod/" \
  --with-decryption \
  --region us-east-1 | python3 -c "
import sys, json
data = json.load(sys.stdin)
for p in data.get('Parameters', []):
    name = p['Name'].split('/')[-1]
    print(f'{name}={p[\"Value\"]}')
" > /home/ubuntu/.env

# Restrict file permissions so only the owner can read it
chmod 600 /home/ubuntu/.env
```

---

## ⚙️ Step 2: Jenkins Server Configuration

The CI/CD build process runs on your Jenkins server to offload resource consumption from the `t2.micro` host.

### 1. Install Required Plugins
Navigate to **Manage Jenkins** > **Plugins** > **Available Plugins** and install:
- **CloudBees AWS Credentials** (for ECR authentication)
- **SSH Agent** (for SSH & SCP deployments)
- **Pipeline: Utility Steps**
- **AnsiColor** (optional, for colorized logs)

### 2. Configure Credentials
Navigate to **Manage Jenkins** > **Credentials** > **System** > **Global credentials** and add:

1. **AWS Credentials**:
   - Kind: `AWS Credentials`
   - ID: `aws-credentials-id` (Matches the value in `Jenkinsfile`)
   - Access Key ID: `YOUR_AWS_ACCESS_KEY_ID`
   - Secret Access Key: `YOUR_AWS_SECRET_ACCESS_KEY`

2. **EC2 SSH Private Key**:
   - Kind: `SSH Username with private key`
   - ID: `ec2-ssh-key-id` (Matches the value in `Jenkinsfile`)
   - Username: `ubuntu`
   - Private Key: Click `Enter directly` and paste the contents of your EC2 `.pem` private key file.

### 3. Update Pipeline Environment Variables
Ensure the following variables in the [Jenkinsfile](file:///d:/SLIITek/BackEnd_SLIITek/Jenkinsfile) environment block match your setup:
```groovy
environment {
    AWS_ACCOUNT_ID     = '123456789012'       // Your AWS Account ID
    AWS_DEFAULT_REGION = 'us-east-1'           // Your target AWS ECR region
    ECR_REGISTRY       = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
    ECR_REPOSITORY     = 'sliitek-backend'     // Matches your AWS ECR repo name
    IMAGE_TAG          = 'latest'
    EC2_HOST           = '54.xxx.xxx.xxx'      // Your EC2 public IP or DNS
    EC2_USER           = 'ubuntu'
}
```

---

## 🚀 Step 3: Run the Jenkins Pipeline

1. In Jenkins, create a **Pipeline** project pointing to the backend Git repository.
2. Trigger the build manually or set up a Git webhook.
3. The pipeline will automatically:
   - Perform a clean workspace checkout.
   - Run tests (`npm install` followed by `npm test`).
   - Build a production Docker image using `Dockerfile`.
   - Log into ECR and push the built image.
   - SCP `docker-compose.prod.yml` to the EC2 host as `/home/ubuntu/docker-compose.yml`.
   - SSH into the EC2 host, log in to ECR, pull the new image, and run the service:
     ```bash
     docker compose -f /home/ubuntu/docker-compose.yml up -d backend
     ```
   - Prune old dangling images on the EC2 host.

---

## 🛠️ Step 4: Verification & Troubleshooting

### 1. Database Seeding
To populate initial metadata, run the seeding scripts inside the backend container:
```bash
# SSH into the EC2 instance and execute:
docker exec -it sliitek_backend npm run seed:users
docker exec -it sliitek_backend npm run seed:dashboard
```

### 2. Verify Container Logs
To inspect backend logs and ensure express is running:
```bash
docker logs -f sliitek_backend
```
Look for: `Server running on port 5000` or database connection success logs.

### 3. Check Network and Ports
Ensure the `sliitek_net` network and both the backend and local Redis services are running correctly:
```bash
docker ps
# Output should show sliitek_backend on port 5000 and sliitek_redis on port 6379
```

---

## ⚡ Manual Deployment Fallback

If the Jenkins pipeline is unavailable, you can deploy manually directly from the EC2 host:

1. SSH into the EC2 host.
2. Clone the repository or download `docker-compose.prod.yml`.
3. Log in to AWS ECR manually:
   ```bash
   aws ecr get-login-password --region <AWS_DEFAULT_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_DEFAULT_REGION>.amazonaws.com
   ```
4. Build or pull the image manually:
   ```bash
   docker compose -f docker-compose.prod.yml pull
   ```
5. Deploy:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

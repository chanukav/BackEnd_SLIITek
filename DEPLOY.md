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
To grant the EC2 instance access to the AWS Parameter Store and ECR registries:
1. Open the **IAM Console** > **Roles** > **Create role**.
2. Select **AWS Service** and choose **EC2**.
3. Attach the following managed policies:
   - **`AmazonSSMReadOnlyAccess`** (to read SSM secrets)
   - **`AmazonEC2ContainerRegistryReadOnly`** (to pull Docker images from AWS ECR)
4. Name the role `sliitek-ec2-ssm-role` and click **Create**.
5. Go to the **EC2 Console** > **Instances**, select your instance, and choose **Actions** > **Security** > **Modify IAM role**. Select `sliitek-ec2-ssm-role` and save.

> [!WARNING]
> **Permissions Boundary Error:** If you hit an `AccessDeniedException` when running ECR login on the EC2 instance, check if a **Permissions Boundary** is set on the `sliitek-ec2-ssm-role` in the IAM Console. Either remove the boundary or update it to explicitly allow `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, and `ecr:BatchGetImage`.

#### Step C: Dynamically Build the `.env` File on EC2
Instead of creating the file manually, log into the EC2 instance and run this command to pull the secrets securely from SSM and build the `.env` file on the fly (targeting the `ap-south-1` region):
```bash
aws ssm get-parameters-by-path \
  --path "/sliitek/prod/" \
  --with-decryption \
  --region ap-south-1 | python3 -c "
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

> [!IMPORTANT]
> **Windows Agent Compatibility:** Because the Jenkins agent is running on a **Windows** host, the pipeline is written using native Windows batch (`bat`) commands instead of standard POSIX shell (`sh`) commands.

### 1. Configure System Environment Path in Jenkins
To ensure Jenkins can find your Git Bash shell utilities (like `ssh` and `scp`) when running batch commands:
1. Go to the Jenkins Dashboard.
2. Click **Manage Jenkins** > **System**.
3. Scroll to **Global properties** -> check **Environment variables**.
4. Click **Add** to configure:
   - **Name:** `PATH+GIT_BIN`
   - **Value:** `C:\Program Files\Git\bin`
5. Click **Add** to configure:
   - **Name:** `PATH+GIT_USR_BIN`
   - **Value:** `C:\Program Files\Git\usr\bin`
6. Click **Save**.

### 2. Configure Credentials in Jenkins
Navigate to **Manage Jenkins** > **Credentials** > **System** > **Global credentials** and add:

1. **AWS Account ID**:
   - Kind: `Secret text`
   - ID: `AWS_ACCOUNT_ID` (Matches the credentials reference in `Jenkinsfile`)
   - Secret: `YOUR_12_DIGIT_AWS_ACCOUNT_ID`

2. **AWS CLI Programmatic Credentials**:
   - Kind: `AWS Credentials`
   - ID: `aws-credentials-id` (Matches the value in `Jenkinsfile`)
   - Access Key ID & Secret Access Key: `YOUR_AWS_ACCESS_KEYS`

3. **EC2 SSH Private Key**:
   - Kind: `SSH Username with private key`
   - ID: `ec2-ssh-key-id` (Matches the value in `Jenkinsfile`)
   - Username: `ubuntu`
   - Private Key: Click `Enter directly` and paste the contents of your EC2 `.pem` private key file.

### 3. Configure Jenkins Global Environment Variables
To keep your pipeline code clean and generic:
1. Under **Global properties** -> **Environment variables** (configured in the System dashboard), add:
   - **Name:** `EC2_HOST_IP`
   - **Value:** Your EC2 Instance's public IP address (e.g., `65.2.179.56`).

### 4. Update Pipeline Environment Variables
Ensure the following variables in the [Jenkinsfile](file:///d:/SLIITek/BackEnd_SLIITek/Jenkinsfile) environment block match your setup (secrets and IPs are dynamically fetched at runtime to prevent code hardening):
```groovy
environment {
    AWS_ACCOUNT_ID     = credentials('AWS_ACCOUNT_ID') // Retrieve from Jenkins Credentials Store
    AWS_DEFAULT_REGION = 'ap-south-1'                  // Target AWS ECR region
    ECR_REPOSITORY     = 'sliitek-backend'             // Matches AWS ECR repo name
    IMAGE_TAG          = "build-\${env.BUILD_NUMBER}"
    EC2_HOST           = "\${env.EC2_HOST_IP}"           // Retrieve from Jenkins Global Environment Variables
    EC2_USER           = 'ubuntu'
}
```

> [!NOTE]
> **SSH Agent Plugin Bypass:** The Jenkins `sshagent` plugin has a known Windows compatibility bug that throws parsing errors during environment setup. The pipeline is securely configured to use `withCredentials` and `sshUserPrivateKey` to load the private key into a secure temporary file (`SSH_KEY_PATH`) and pass it to SSH/SCP directly using the `-i` parameter.

---

## 🚀 Step 3: Configure Triggers & Run the Jenkins Pipeline

The pipeline is configured with a `triggers` block to support automated error checking on code pushes.

### 1. Configure Automatic Push Triggers (Webhooks)
To have Jenkins automatically trigger builds when you push commits to GitHub:
1. **In Jenkins**:
   - Go to your Pipeline job configuration.
   - Under **Build Triggers**, check **GitHub hook trigger for GITScm polling**.
2. **In GitHub**:
   - Go to your repository settings page.
   - Click **Webhooks** > **Add webhook**.
   - Set **Payload URL** to `http://<your-jenkins-server-url>/github-webhook/` (ensure the trailing slash is included).
   - Set **Content type** to `application/json`.
   - Choose **Just the push event** and click **Add webhook**.

*Note: SCM polling (`pollSCM`) is configured in the `Jenkinsfile` as a fallback to poll the repository for changes every 5 minutes if webhooks are not set up.*

### 2. Multi-Branch Pipeline & Validation Behavior
To protect the production environment, the pipeline behaves differently based on the branch being built:
- **All Branches**: Upon push, the pipeline will run full validation tests (`npm install` followed by `npm test`) to check whether there are any errors. If any tests fail, the build fails and you are immediately notified.
- **`main` Branch Only**: If the branch is `main`, the pipeline proceeds to build the Docker image, push it to AWS ECR, and deploy it to the EC2 host. For other branches, these deployment steps are skipped.

### 3. Pipeline Execution Flow
When a build is triggered, the pipeline:
1. Performs a clean workspace checkout.
2. Runs validation tests (`npm install` followed by `npm test`).
3. (If branch is `main`) Builds a production Docker image using `Dockerfile`.
4. (If branch is `main`) Logs into ECR and pushes the built image.
5. (If branch is `main`) SCPs `docker-compose.prod.yml` to the EC2 host as `/home/ubuntu/docker-compose.yml`.
6. (If branch is `main`) SSHes into the EC2 host, logs in to ECR, pulls the new image, performs rolling updates, and deploys.
7. (If branch is `main`) Prunes old dangling images on the EC2 host.

---

## 🛠️ Step 4: Verification & Troubleshooting

### 1. Database Seeding
To populate initial metadata, run the seeding scripts inside one of the backend containers (e.g., `sliitek_backend_a`):
```bash
# SSH into the EC2 instance and execute:
docker exec -it sliitek_backend_a npm run seed:users
docker exec -it sliitek_backend_a npm run seed:dashboard
```

### 2. Verify Container Logs
To inspect backend logs and ensure Express is running:
```bash
docker logs -f sliitek_backend_a
# or
docker logs -f sliitek_backend_b
```
Look for: `Server running on port 5000` or database connection success logs.

### 3. Check Network and Ports
Ensure the `sliitek_net` network and both the backend nodes and local Redis services are running correctly:
```bash
docker ps
# Output should show sliitek_backend_a and sliitek_backend_b on port 5000, and sliitek_redis on port 6379
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

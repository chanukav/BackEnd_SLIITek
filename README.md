# SLIITek Backend 🚀

This repository contains the Node.js Express backend monolith for **SLIITek**, a collaborative Q&A and community platform designed for students and staff. The backend is built using Express, MongoDB (Mongoose), and Redis (BullMQ) for queue processing, and is optimized for deployment to AWS Free Tier using a Jenkins CI/CD pipeline and Docker Compose.

---

## 🌟 Key Features

- **Robust Authentication & Security**:
  - JWT-based session management using HttpOnly cookies for security.
  - Sign-up email verification via OTP (using NodeMailer).
  - Forgot password flow using Twilio Verify (WhatsApp OTP with SMS fallback) or Email.
  - Express-rate-limit middleware to prevent brute-force attacks on sensitive endpoints.
- **Q&A Core Functionality**:
  - Full CRUD operations for Questions, Answers, and Comments.
  - Voting system (upvote/downvote) for questions and answers.
  - Answer acceptance mechanism by the question owner.
- **Content Moderation & Safety**:
  - Automatic profanity detection using `leo-profanity` on new questions and answers.
  - Reporting system for user flags on inappropriate posts/comments.
  - Admin dashboard endpoints for viewing reports, suspending users, and performing audit logs.
  - Real-time admin moderation socket events via **Socket.io**.
- **Background Jobs & Worker System**:
  - Built-in **BullMQ** worker processes for handling email/SMS notifications and report exports asynchronously without blocking the primary event loop.
  - Relies on **Redis** for managing background job queues.
- **Cloud Media Uploads**:
  - Direct upload handling using **Multer** and integration with **Azure Blob Storage** for persistent, secure storage of question images and user profile avatars with time-limited SAS URLs.
- **System Monitoring**:
  - Dedicated `/api/health` endpoint reporting overall system health and MongoDB connection status.

---

## 🛠️ Technology Stack

- **Runtime**: Node.js (v20+)
- **Framework**: Express.js
- **Database**: MongoDB (via Mongoose ORM)
- **Caching & Queues**: Redis & BullMQ
- **Real-Time Communication**: Socket.io
- **Media Storage**: Azure Blob Storage (via `@azure/storage-blob`)
- **Testing**: Node.js Native Test Runner (`node --test`)
- **Security**: Bcrypt (hashing), JSON Web Tokens (JWT)

---

## 📂 Project Structure

```text
BackEnd_SLIITek/
├── src/
│   ├── config/             # DB and system configuration
│   ├── controllers/        # Express route controller logic
│   ├── data/               # Static or seeding data sources
│   ├── middleware/         # Auth, rate-limiter, and role verification middleware
│   ├── models/             # Mongoose schemas (User, Question, Answer, Report, etc.)
│   ├── queues/             # BullMQ queue definitions
│   ├── routes/             # Express API endpoint definitions
│   ├── scripts/            # Database seeding and cleanup utilities
│   ├── services/           # External service handlers (Azure, Twilio, Email)
│   ├── utils/              # Helper functions (Socket helper, Token generators)
│   ├── workers/            # Background job workers (BullMQ)
│   └── server.js           # Monolith application entry point
├── tests/                  # Integration and unit tests
├── Dockerfile              # Containerization recipe
├── docker-compose.prod.yml # Production multi-container composition
├── Jenkinsfile             # CI/CD pipeline definition for Jenkins Windows Agent
├── DEPLOY.md               # Detailed AWS deployment instructions
└── README.md               # You are here!
```

---

## ⚙️ Environment Variables

Copy the `.env.example` file to `.env` in the repository root and fill in the parameters:

| Variable | Description | Required in Production |
| :--- | :--- | :--- |
| `PORT` | Local server port (Default: `5000`) | No |
| `MONGO_URI` | MongoDB Connection String (Atlas recommended) | Yes |
| `JWT_SECRET` | Secret key used for signing JWT cookies | Yes |
| `CLIENT_URL` / `CLIENT_URLS` | Allowed CORS origins (comma-separated for multiples) | Yes |
| `REDIS_HOST` | Hostname for Redis (Default: `localhost`) | Yes (Queue/Worker functionality) |
| `REDIS_PORT` | Port for Redis (Default: `6379`) | Yes |
| `EMAIL_USER` / `EMAIL` | SMTP Username/Email for sending OTPs | Yes (for Email OTP) |
| `EMAIL_PASS` / `PASS` | SMTP Password (Gmail: App Password) | Yes (for Email OTP) |
| `EMAIL_SMTP_HOST` | Custom SMTP host (falls back to Gmail) | No |
| `EMAIL_SMTP_PORT` | Custom SMTP port (e.g. `587` or `465`) | No |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | Yes (for WhatsApp/SMS OTP) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | Yes (for WhatsApp/SMS OTP) |
| `TWILIO_VERIFY_SERVICE_SID`| Twilio Verify Service SID | Yes (for WhatsApp/SMS OTP) |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Storage Connection String | Yes (for Cloud Media Uploads) |
| `AZURE_BLOB_CONTAINER_QUESTION_IMAGES` | Azure Container name (Default: `question-images`) | No |

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v20 or higher)
- **MongoDB** (Local instance or MongoDB Atlas account)
- **Redis** (Required for background jobs. Use local installation or Docker container: `docker run -d -p 6379:6379 redis:alpine`)

### Setup Instructions

1. **Clone the repository**:
   ```bash
   git clone https://github.com/chanukav/BackEnd_SLIITek.git
   cd BackEnd_SLIITek
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   # Edit .env and populate with your credentials
   ```

4. **Seed the Database (Optional)**:
   We provide seeding scripts to fill local databases with mock data:
   ```bash
   # Seed system users (Admin, Staff, Student)
   npm run seed:users

   # Seed dashboard statistics & sample questions/answers
   npm run seed:dashboard
   ```

5. **Start the Application**:
   - **Development Mode** (with automatic nodemon reload):
     ```bash
     npm run dev
     ```
   - **Production Mode**:
     ```bash
     npm run start
     ```
   - **Start the Queue Worker** (Run in a separate process/terminal):
     ```bash
     npm run worker
     ```

---

## 🧪 Testing

The backend uses Node's native test runner to perform API integration and helper tests.

- **Run all tests**:
  ```bash
  npm run test
  ```

---

## 🚢 CI/CD & Deployment

This project is configured to build and deploy automatically via **Jenkins** to an **AWS EC2** instance using Docker Compose:

1. **Build Agent**: Built on a Windows Jenkins Agent which runs Docker builds.
2. **Orchestration**: Combines frontend, dual backend services (`sliitek_backend_a` and `sliitek_backend_b` for load balancing/high availability), and a Redis instance under a bridged Docker network.
3. **Production Secrets**: Secured using **AWS Systems Manager (SSM) Parameter Store** to prevent checking secrets into repository history.

For step-by-step infrastructure provisioning and deployment configuration, please refer to the detailed [DEPLOY.md](file:///d:/SLIITek/BackEnd_SLIITek/DEPLOY.md) file.
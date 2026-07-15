# Contributing to SLIITek Backend

Thank you for your interest in contributing to the SLIITek Backend! To maintain code quality and ensure a smooth integration process, please review and follow these guidelines.

## Code of Conduct

By participating in this project, you agree to treat all contributors with respect and professionalism.

## Getting Started

1. **Fork/Clone** the repository and create your feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Install Dependencies**:
   ```bash
   npm install
   ```
3. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in local testing parameters. **Never commit your `.env` file.**

## Development Standards

- **Write Clean Code**: Adhere to ESLint rules and maintain consistent code formatting.
- **Keep Comments Intact**: Retain existing docstrings and code comments unless explicitly updating the logic they describe.
- **Tests**: Add unit or integration tests under the `tests/` directory for any new features or bug fixes.
  - Run tests locally using: `npm run test`
- **Linting**: Ensure code has no syntax or formatting issues before pushing.

## Commit Messages

Please write clear, meaningful commit messages following the Conventional Commits style:
- `feat: add email verification during sign-up`
- `fix: resolve JWT expiration parsing error`
- `docs: update deployment guidelines`

## Pull Request Process

1. Push your branch to GitHub.
2. Submit a Pull Request (PR) targeting the `main` branch.
3. Fill out the PR template completely.
4. Ensure the Jenkins CI/CD pipeline tests pass successfully.
5. Obtain review and approval from at least one repository administrator or project lead.

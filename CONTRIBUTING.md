# Contributing to DualTran

Thank you for your interest in contributing to DualTran! This document provides guidelines and information for contributors.

## Code of Conduct

Please be respectful and inclusive in all interactions. We are committed to providing a welcoming and harassment-free experience for everyone.

## How to Contribute

### Reporting Bugs

1. Check existing [issues](https://github.com/seigwen/DualTran-extension/issues) to avoid duplicates
2. Create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser version and OS
   - Screenshots if applicable

### Suggesting Features

1. Open a [feature request](https://github.com/seigwen/DualTran-extension/issues/new?template=feature_request.md)
2. Describe the feature and use case
3. Explain why it would be useful

### Submitting Code

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**:
   - Follow the coding style (see below)
   - Add comments for complex logic
   - Update documentation if needed
4. **Test your changes**:
   ```bash
   npm test
   npm run build
   ```
5. **Commit your changes**:
   ```bash
   git commit -m "feat: add new feature"
   ```
   Use [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `style:` for formatting
   - `refactor:` for code refactoring
   - `test:` for adding tests
   - `chore:` for maintenance

6. **Push and create a Pull Request**

## Development Setup

1. Clone and install:
   ```bash
   git clone https://github.com/seigwen/DualTran-extension.git
   cd DualTran-extension
   npm install
   ```

2. Development mode:
   ```bash
   npm run dev
   ```

3. Load extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" → select `dist/chrome/`

## Coding Style

### General
- Use descriptive variable and function names
- Add comments for all functions, classes, and important variables
- Comments should be in **English**

### JavaScript
- Use ES6+ features
- Use `const` by default, `let` when needed
- Avoid `var`
- Use template literals for string concatenation

### File Organization
- One module per file
- Use descriptive file names
- Keep files focused and small

### i18n
- Always use i18n for user-facing strings
- Messages are in `src/_locales/`
- Use `chrome.i18n.getMessage()` for translations

## Testing

### Unit Tests
```bash
npm test
```

### Coverage
```bash
npm run test:coverage
```

### E2E Tests
```bash
npm run test:browser-e2e
```

## Project Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Questions?

Feel free to open an issue for any questions about contributing.

## License

By contributing, you agree that your contributions will be licensed under the Mozilla Public License 2.0.

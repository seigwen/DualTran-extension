# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.1.x   | ✅ Yes             |
| < 2.1   | ❌ No              |

## Reporting a Vulnerability

If you discover a security vulnerability in DualTran, please report it responsibly.

### How to Report

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. Email security concerns to: [your-email@example.com]
3. Include the following information:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Fix Release**: Depends on severity
  - Critical: Within 1 week
  - High: Within 2 weeks
  - Medium/Low: Next scheduled release

## Security Considerations

### API Keys

- API keys are stored locally in `chrome.storage.local`
- Keys are never transmitted to our servers
- Keys are only sent to the respective AI provider APIs

### Permissions

The extension requests minimal permissions:
- `storage` - For saving settings
- `activeTab` - For accessing current tab content
- `contextMenus` - For right-click translation
- `webRequest` - For detecting page content type
- `alarms` - For scheduled tasks
- `offscreen` - For background processing
- `declarativeNetRequest` - For request modification

### Data Privacy

- No user data is collected or transmitted to third parties
- Translation requests go directly to Google Translate or user-configured AI providers
- See [Privacy Policy](privacy-policies/index.html) for details

## Best Practices for Users

1. **Keep the extension updated** to the latest version
2. **Review permissions** before installing
3. **Use official AI provider APIs** only
4. **Report suspicious behavior** immediately

## Acknowledgments

We appreciate security researchers who responsibly disclose vulnerabilities. Contributors will be acknowledged in release notes (unless they prefer anonymity).

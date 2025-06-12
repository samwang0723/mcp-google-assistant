# MCP Google Assistant

AI-powered Google Gmail/Calendar MCP server that provides Gmail access through Bearer token authentication.

## Features

- 📧 **Gmail Integration**: Read email lists and get individual email details
- 🔍 **Email Search**: Search emails using Gmail query syntax
- 🔐 **Bearer Token Auth**: Secure authentication using Google OAuth2 access tokens
- 🚀 **MCP Protocol**: Compatible with Model Context Protocol for AI integration

## Gmail Functions

### Available Tools

1. **`gmail-list-emails`** - Get a list of emails with optional filtering
2. **`gmail-get-email`** - Get detailed information about a specific email
3. **`gmail-search-emails`** - Search emails using Gmail query syntax
4. **`gmail-get-unread`** - Get unread emails

### Authentication

This server uses **Bearer token authentication**. External upstream services should include the Google OAuth2 access token in the Authorization header:

```
Authorization: Bearer <your-google-oauth2-access-token>
```

### Required Google API Scopes

Your access token must include the following Gmail API scopes:

- `https://www.googleapis.com/auth/gmail.readonly` - Read access to Gmail

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd mcp-google-assistant
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

4. Start the server:

```bash
npm start
```

The server will start on `http://localhost:3000` by default.

## Configuration

Set environment variables as needed:

```bash
# Server Configuration
PORT=3000
LOG_LEVEL=info
```

## Usage Examples

### 1. Get Email List

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gmail-list-emails",
    "arguments": {
      "maxResults": 10,
      "query": "is:unread"
    }
  },
  "id": 1
}
```

### 2. Get Email Details

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gmail-get-email",
    "arguments": {
      "messageId": "1234567890abcdef",
      "format": "full"
    }
  },
  "id": 2
}
```

### 3. Search Emails

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gmail-search-emails",
    "arguments": {
      "query": "from:example@gmail.com subject:important",
      "maxResults": 5
    }
  },
  "id": 3
}
```

### 4. Get Unread Emails

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gmail-get-unread",
    "arguments": {
      "maxResults": 20
    }
  },
  "id": 4
}
```

## Gmail Query Syntax

The search functions support Gmail's query syntax:

- `from:sender@example.com` - Emails from specific sender
- `to:recipient@example.com` - Emails to specific recipient
- `subject:keyword` - Emails with keyword in subject
- `is:unread` - Unread emails
- `is:important` - Important emails
- `has:attachment` - Emails with attachments
- `after:2023/1/1` - Emails after specific date
- `before:2023/12/31` - Emails before specific date

You can combine multiple criteria: `from:boss@company.com is:unread`

## Error Handling

The server provides detailed error messages for common scenarios:

- **MISSING_AUTHORIZATION**: No Authorization header provided
- **INVALID_BEARER_TOKEN**: Malformed bearer token
- **AUTHENTICATION_FAILED**: Invalid or expired access token
- **PERMISSION_DENIED**: Insufficient Gmail API permissions
- **RATE_LIMIT_EXCEEDED**: Gmail API quota exceeded
- **EMAIL_NOT_FOUND**: Requested email doesn't exist

## Development

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues automatically

### Project Structure

```
src/
├── config/          # Configuration management
├── services/        # Gmail service implementation
│   └── gmail.ts     # Main Gmail API integration
├── utils/          # Utility functions
└── index.ts        # MCP server setup
```

## License

MIT License

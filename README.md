# MCP Google Assistant

AI-powered Google Gmail/Calendar MCP server that provides Gmail and Google Calendar access through Bearer token authentication.

## Features

- 📧 **Gmail Integration**: Read email lists and get individual email details
- 🔍 **Email Search**: Search emails using Gmail query syntax
- 📅 **Google Calendar Integration**: List calendars, events, create events, and manage invitations
- 🕐 **DateTime Utilities**: Convert datetime strings between different formats
- 🔐 **Bearer Token Auth**: Secure authentication using Google OAuth2 access tokens
- 🚀 **MCP Protocol**: Compatible with Model Context Protocol for AI integration

## Available MCP Tools

### Gmail Tools

1. **`gmail_list_emails`** - Get a list of emails with optional filtering and batch detail fetching
2. **`gmail_get_details`** - Get detailed information about a specific email with configurable word limits
3. **`gmail_search_emails`** - Search emails using Gmail query syntax

### Google Calendar Tools

4. **`gcalendar_list_calendars`** - Get a list of all calendars in the user's calendar list
5. **`gcalendar_list_events`** - Get a list of events from a specified calendar with time range filtering
6. **`gcalendar_create_event`** - Create a new event in a calendar with attendees and notifications
7. **`gcalendar_decline_event`** - Decline an invitation to a calendar event

### Utility Tools

8. **`datetime_converter`** - Convert datetime strings to different formats (ISO, UTC, Unix timestamp)

### Authentication

This server uses **Bearer token authentication**. External upstream services should include the Google OAuth2 access token in the Authorization header:

```
Authorization: Bearer <your-google-oauth2-access-token>
```

### Required Google API Scopes

Your access token must include the following Google API scopes:

**Gmail API Scopes:**
- `https://www.googleapis.com/auth/gmail.readonly` - Read access to Gmail

**Google Calendar API Scopes:**
- `https://www.googleapis.com/auth/calendar` - Full access to Google Calendar
- `https://www.googleapis.com/auth/calendar.readonly` - Read-only access to Google Calendar (minimum required)
- `https://www.googleapis.com/auth/calendar.events` - Access to events (required for creating/modifying events)

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

### Gmail Tools

#### 1. List Emails with Details

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gmail_list_emails",
    "arguments": {
      "maxResults": 10,
      "query": "is:unread",
      "fetchDetails": true
    }
  },
  "id": 1
}
```

#### 2. Get Email Details

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gmail_get_details",
    "arguments": {
      "messageId": "1234567890abcdef",
      "format": "full",
      "maxWords": 500
    }
  },
  "id": 2
}
```

#### 3. Search Emails

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gmail_search_emails",
    "arguments": {
      "query": "from:example@gmail.com subject:important",
      "maxResults": 5
    }
  },
  "id": 3
}
```

### Google Calendar Tools

#### 4. List Calendars

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gcalendar_list_calendars",
    "arguments": {}
  },
  "id": 4
}
```

#### 5. List Events

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gcalendar_list_events",
    "arguments": {
      "calendarId": "primary",
      "maxResults": 20,
      "timeMin": "2025-07-31T00:00:00Z",
      "timeMax": "2025-08-31T23:59:59Z"
    }
  },
  "id": 5
}
```

#### 6. Create Event

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "gcalendar_create_event",
    "arguments": {
      "calendarId": "primary",
      "summary": "Team Meeting",
      "description": "Weekly team sync meeting",
      "location": "Conference Room A",
      "start": {
        "dateTime": "2025-08-01T15:00:00-07:00",
        "timeZone": "America/Los_Angeles"
      },
      "end": {
        "dateTime": "2025-08-01T16:00:00-07:00",
        "timeZone": "America/Los_Angeles"
      },
      "attendees": ["colleague@example.com"],
      "sendNotifications": true
    }
  },
  "id": 6
}
```

### Utility Tools

#### 7. Convert DateTime

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "datetime_converter",
    "arguments": {
      "datetime": "July 31, 2025 3:00 PM PST",
      "format": "iso"
    }
  },
  "id": 7
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

- `npm run dev` - Start development server with hot reload using tsx
- `npm run build` - Build TypeScript to JavaScript (outputs to dist/)
- `npm start` - Start production server from built JavaScript
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run quality` - Run comprehensive quality checks (type-check + lint + format:check)
- `npm test` - Run Jest tests

### Project Structure

```
src/
├── config/
│   └── index.ts         # Server configuration
├── services/
│   ├── gmail.ts         # Gmail API integration with batch operations
│   ├── gcalendar.ts     # Google Calendar API integration
│   └── types.ts         # TypeScript type definitions
├── utils/
│   └── logger.ts        # Winston logger configuration
├── index.ts             # MCP server setup and tool definitions
└── register-paths.ts    # TypeScript path aliases runtime registration
```

## License

MIT License

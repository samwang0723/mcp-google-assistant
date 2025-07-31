# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development Tasks
- `npm run dev` - Start development server with hot reload using tsx
- `npm run build` - Build TypeScript to JavaScript (outputs to dist/)
- `npm start` - Start production server from built JavaScript
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run quality` - Run full quality check (type-check + lint + format:check)
- `npm test` - Run Jest tests

### Development Workflow
1. Use `npm run dev` for development - it watches files and restarts automatically
2. Always run `npm run quality` before committing changes
3. Build with `npm run build` to verify TypeScript compilation
4. The server runs on port 3000 by default (configurable via PORT env var)

## Architecture Overview

This is an **MCP (Model Context Protocol) server** that provides AI models with access to Gmail and Google Calendar APIs through Bearer token authentication.

### Core Architecture Components

**MCP Server Structure:**
- Built using `@modelcontextprotocol/sdk` for MCP protocol compliance
- Uses Express.js with `StreamableHTTPServerTransport` for HTTP communication
- Session-based architecture with UUID session identifiers for stateful connections
- Bearer token authentication extracted from request headers per session

**Service Layer:**
- `GmailService` - Core Gmail API integration with batch operations and error handling
- `GCalendarService` - Google Calendar API integration
- Both services use Google OAuth2 client with access tokens
- Services are instantiated per-session with token from Authorization header

**Key Technical Details:**
- TypeScript paths are configured with `@/`, `@config/`, `@services/`, `@utils/` aliases
- Uses `register-paths.ts` for runtime path resolution
- Zod schemas for input validation on all MCP tools
- Comprehensive error handling with custom error classes (`GmailServiceError`, `GCalendarServiceError`)

### Available MCP Tools

**Gmail Tools:**
- `gmail_list_emails` - List emails with filtering, pagination, and batch detail fetching
- `gmail_get_details` - Get detailed email content with configurable word limits
- `gmail_search_emails` - Search using Gmail query syntax

**Calendar Tools:**
- `gcalendar_list_calendars` - List all user calendars
- `gcalendar_list_events` - List events with time range filtering
- `gcalendar_create_event` - Create new calendar events
- `gcalendar_decline_event` - Decline event invitations

**Utility Tools:**
- `datetime_converter` - Convert datetime strings between formats (ISO, UTC, Unix)

### Authentication Flow

1. External clients must include `Authorization: Bearer <google-oauth2-token>` header
2. Server extracts token per session and creates service instances
3. Required Google API scopes: `https://www.googleapis.com/auth/gmail.readonly`, Calendar scopes
4. Services handle token validation and refresh automatically

### Configuration

- Uses dotenv for environment variables
- Main config in `src/config/index.ts`
- Winston logger configured in `src/utils/logger.ts`
- Server listens on all interfaces (0.0.0.0) for containerized deployment

### Error Handling Strategy

- Custom error classes with structured error codes and HTTP status codes
- Rate limiting with exponential backoff retry logic
- Comprehensive Gmail API error mapping (401 auth, 403 permissions, 429 rate limits)
- Session-based error context preservation

### Performance Optimizations

- Batch email fetching using Gmail batch API (up to 100 emails per request)
- Configurable text truncation for email bodies (default 300 words)
- Selective header inclusion to reduce payload size
- SSL verification can be disabled for development (not recommended for production)
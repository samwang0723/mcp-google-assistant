#!/usr/bin/env node

// Register TypeScript path mappings for runtime resolution
import './register-paths';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  TextContent,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import config from '@config/index';
import GmailService, {
  GmailServiceError,
  GmailServiceOptions,
} from '@services/gmail';
import GCalendarService, { GCalendarServiceError } from '@services/gcalendar';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

// Global map to store current request headers by session ID
const sessionHeaders: {
  [sessionId: string]: { [key: string]: string | string[] | undefined };
} = {};

// Helper function to extract Bearer token from headers
function extractBearerToken(headers: {
  [key: string]: string | string[] | undefined;
}): string | null {
  const authHeader = headers.authorization || headers.Authorization;

  if (!authHeader) {
    return null;
  }

  const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  if (!authValue || !authValue.startsWith('Bearer ')) {
    return null;
  }

  return authValue.substring(7); // Remove "Bearer " prefix
}

// Helper function to create Gmail service from current session headers
function createGmailServiceFromSession(sessionId: string): GmailService {
  const headers = sessionHeaders[sessionId];

  if (!headers) {
    throw new GmailServiceError(
      'No authentication context found. Please ensure the request includes proper session headers.',
      'NO_SESSION_CONTEXT'
    );
  }

  const token = extractBearerToken(headers);

  if (!token) {
    throw new GmailServiceError(
      'Missing or invalid Authorization header. Expected format: "Authorization: Bearer <access_token>"',
      'MISSING_AUTHORIZATION'
    );
  }

  const options: GmailServiceOptions = {
    skipSslVerification: true,
  };

  return GmailService.fromBearerToken(token, options);
}

// Helper function to create GCalendar service from current session headers
function createGCalendarServiceFromSession(
  sessionId: string
): GCalendarService {
  const headers = sessionHeaders[sessionId];

  if (!headers) {
    throw new GCalendarServiceError(
      'No authentication context found. Please ensure the request includes proper session headers.',
      'NO_SESSION_CONTEXT'
    );
  }

  const token = extractBearerToken(headers);

  if (!token) {
    throw new GCalendarServiceError(
      'Missing or invalid Authorization header. Expected format: "Authorization: Bearer <access_token>"',
      'MISSING_AUTHORIZATION'
    );
  }

  const options: GmailServiceOptions = {
    skipSslVerification: true,
  };

  return GCalendarService.fromBearerToken(token, options);
}

class McpServerApp {
  private createServer(sessionId: string): McpServer {
    const server = new McpServer({
      name: 'mcp-google-assistant-server',
      version: '1.0.0',
    });

    const EventDateTimeSchema = z.object({
      date: z.string().optional(),
      dateTime: z.string().optional(),
      timeZone: z.string().optional(),
    });

    // Register Gmail list emails tool
    server.tool(
      'gmail_list_emails',
      'Get a list of emails from Gmail with optional filtering and details',
      {
        maxResults: z
          .number()
          .min(1)
          .max(30)
          .default(10)
          .describe(
            'Maximum number of emails to return (default: 10, max: 30)'
          ),
        pageToken: z
          .string()
          .optional()
          .describe('Token for pagination to get next page of results'),
        query: z
          .string()
          .optional()
          .describe(
            'Gmail search query (e.g., "from:example@gmail.com", "is:unread", "subject:important")'
          ),
        labelIds: z
          .array(z.string())
          .optional()
          .describe('Array of label IDs to filter by'),
        includeSpamTrash: z
          .boolean()
          .default(false)
          .describe(
            'Whether to include spam and trash emails (default: false)'
          ),
        fetchDetails: z
          .boolean()
          .default(true)
          .describe(
            'If true, fetches full details for each email in the list using a single batch request.'
          ),
      },
      async options => {
        try {
          const gmailService = createGmailServiceFromSession(sessionId);
          const emailList = await gmailService.getEmailList(options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(emailList, null, 2),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof GmailServiceError
              ? `Gmail API Error [${error.code}]: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          throw new Error(`Error fetching email list: ${errorMessage}`);
        }
      }
    );

    // Register Gmail get email details tool
    server.tool(
      'gmail_get_details',
      'Get detailed information about a specific email',
      {
        messageId: z
          .string()
          .min(1)
          .describe('The ID of the email message to retrieve'),
        format: z
          .enum(['minimal', 'full', 'raw', 'metadata'])
          .optional()
          .describe('The format of the message (default: full)'),
        maxWords: z
          .number()
          .min(300)
          .max(3000)
          .default(1000)
          .describe('The maximum number of words to return (default: 300)'),
      },
      async options => {
        try {
          const gmailService = createGmailServiceFromSession(sessionId);
          const emailDetails = await gmailService.getEmailDetails(options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(emailDetails, null, 2),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof GmailServiceError
              ? `Gmail API Error [${error.code}]: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          throw new Error(`Error fetching email details: ${errorMessage}`);
        }
      }
    );

    // Register tool for converting date-time strings
    server.tool(
      'datetime_converter',
      'Convert a date-time string to a different format or timezone',
      {
        datetime: z
          .string()
          .describe(
            'The date-time string to convert (e.g., "2024-07-20T15:00:00-07:00", "July 20, 2024 3:00 PM PST")'
          ),
        format: z
          .enum(['iso', 'utc', 'unix'])
          .default('iso')
          .optional()
          .describe(
            'The target format: "iso" (default ISO 8601), "utc" (alias for iso), or "unix" (timestamp in seconds).'
          ),
      },
      async ({ datetime, format }) => {
        try {
          const date = new Date(datetime);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date-time string provided.');
          }

          let result: string | number;
          switch (format) {
            case 'unix':
              result = Math.floor(date.getTime() / 1000);
              break;
            case 'iso':
            case 'utc':
            default:
              result = date.toISOString();
              break;
          }

          return {
            content: [
              {
                type: 'text',
                text: String(result),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Error converting date-time: ${errorMessage}`);
        }
      }
    );

    // Register Gmail search emails tool
    server.tool(
      'gmail_search_emails',
      'Search emails using Gmail query syntax',
      {
        query: z
          .string()
          .min(1)
          .describe(
            'Gmail search query (e.g., "from:example@gmail.com", "is:unread", "subject:important")'
          ),
        maxResults: z
          .number()
          .min(1)
          .max(20)
          .default(10)
          .describe(
            'Maximum number of emails to return (default: 10, max: 20)'
          ),
      },
      async ({ query, maxResults }) => {
        try {
          const gmailService = createGmailServiceFromSession(sessionId);
          const searchResults = await gmailService.searchEmails(
            query,
            maxResults
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(searchResults, null, 2),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof GmailServiceError
              ? `Gmail API Error [${error.code}]: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          throw new Error(`Error searching emails: ${errorMessage}`);
        }
      }
    );

    // Register GCalendar list calendars tool
    server.tool(
      'gcalendar_list_calendars',
      'Get a list of all calendars in the user calendar list',
      {},
      async () => {
        try {
          const gcalService = createGCalendarServiceFromSession(sessionId);
          const calendars = await gcalService.listCalendars();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(calendars, null, 2),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof GCalendarServiceError
              ? `GCalendar API Error [${error.code}]: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          throw new Error(`Error listing calendars: ${errorMessage}`);
        }
      }
    );

    // Register GCalendar list events tool
    server.tool(
      'gcalendar_list_events',
      'Get a list of events from a specified calendar',
      {
        calendarId: z
          .string()
          .default('primary')
          .describe(
            `Calendar identifier. Use 'primary' for the primary calendar.`
          ),
        maxResults: z
          .number()
          .min(1)
          .max(50)
          .default(20)
          .describe(`Maximum number of events to return.`),
        timeMin: z
          .string()
          .optional()
          .transform(val => (val ? new Date(val).toISOString() : val))
          .describe(
            `Start of time range (e.g., "2025-07-07T00:00:00+08:00"). It will be automatically converted to UTC. If not set, will list future events.`
          ),
        timeMax: z
          .string()
          .optional()
          .transform(val => (val ? new Date(val).toISOString() : val))
          .describe(
            `End of time range (e.g., "2025-07-07T00:00:00+08:00"). It will be automatically converted to UTC.`
          ),
        query: z.string().optional().describe(`Text search query.`),
      },
      async options => {
        try {
          const gcalService = createGCalendarServiceFromSession(sessionId);
          const events = await gcalService.listEvents(options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(events, null, 2),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof GCalendarServiceError
              ? `GCalendar API Error [${error.code}]: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          throw new Error(`Error listing events: ${errorMessage}`);
        }
      }
    );

    // Register GCalendar create event tool
    server.tool(
      'gcalendar_create_event',
      'Create a new event in a calendar',
      {
        calendarId: z
          .string()
          .default('primary')
          .describe(
            `Calendar identifier. Use 'primary' for the primary calendar.`
          ),
        summary: z.string().describe(`The summary or title of the event.`),
        description: z
          .string()
          .optional()
          .describe(`The description of the event.`),
        location: z.string().optional().describe(`The location of the event.`),
        start: EventDateTimeSchema.describe(
          `The start time of the event. e.g. { "dateTime": "2024-07-20T15:00:00-07:00", "timeZone": "America/Los_Angeles" }`
        ),
        end: EventDateTimeSchema.describe(
          `The end time of the event. e.g. { "dateTime": "2024-07-20T16:00:00-07:00", "timeZone": "America/Los_Angeles" }`
        ),
        attendees: z
          .array(z.string().email())
          .optional()
          .describe(`A list of attendee email addresses.`),
        sendNotifications: z
          .boolean()
          .default(true)
          .describe(
            `Whether to send notifications about the creation of the new event.`
          ),
      },
      async options => {
        try {
          const gcalService = createGCalendarServiceFromSession(sessionId);
          const newEvent = await gcalService.createEvent(options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(newEvent, null, 2),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof GCalendarServiceError
              ? `GCalendar API Error [${error.code}]: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          throw new Error(`Error creating event: ${errorMessage}`);
        }
      }
    );

    // Register GCalendar decline event tool
    server.tool(
      'gcalendar_decline_event',
      'Decline an invitation to a calendar event.',
      {
        calendarId: z
          .string()
          .default('primary')
          .describe(`Calendar identifier. Defaults to 'primary'.`),
        eventId: z.string().describe(`The ID of the event to decline.`),
      },
      async options => {
        try {
          const gcalService = createGCalendarServiceFromSession(sessionId);
          const updatedEvent = await gcalService.declineEvent(options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(updatedEvent, null, 2),
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof GCalendarServiceError
              ? `GCalendar API Error [${error.code}]: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          throw new Error(`Error declining event: ${errorMessage}`);
        }
      }
    );

    return server;
  }

  async run() {
    const app = express();
    app.use(express.json());

    // Map to store transports by session ID for stateful connections
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {};

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'mcp-google-assistant-server' });
    });

    // Handle POST requests for client-to-server communication
    app.post('/mcp', async (req, res) => {
      try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;
        let server: McpServer;

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId];
          // Update session headers with current request headers
          sessionHeaders[sessionId] = req.headers;
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          const newSessionId = randomUUID();

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
            onsessioninitialized: sessionId => {
              // Store the transport by session ID
              transports[sessionId] = transport;
              // Store headers for this session
              sessionHeaders[sessionId] = req.headers;
            },
          });

          // Clean up transport when closed
          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId];
              delete sessionHeaders[transport.sessionId];
            }
          };

          // Create new server instance with session ID
          server = this.createServer(newSessionId);

          // Connect to the MCP server
          await server.connect(transport);
        } else {
          // Invalid request
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (
      req: express.Request,
      res: express.Response
    ) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      // Update session headers
      sessionHeaders[sessionId] = req.headers;

      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    };

    // Handle GET requests for server-to-client notifications via SSE
    app.get('/mcp', handleSessionRequest);

    // Handle DELETE requests for session termination
    app.delete('/mcp', handleSessionRequest);

    // Start the server
    app.listen(config.server.port, '0.0.0.0', () => {
      logger.info(
        `MCP Google Assistant Server running on http://0.0.0.0:${config.server.port}`
      );
      logger.info(
        `Health check available at http://0.0.0.0:${config.server.port}/health`
      );
      logger.info(
        `MCP endpoint available at http://0.0.0.0:${config.server.port}/mcp`
      );
      logger.info('');
      logger.info('📧 Gmail MCP Server ready!');
      logger.info('');
      logger.info('Available tools:');
      logger.info(
        '  - gmail-list-emails: Get a list of emails with optional filtering'
      );
      logger.info(
        '  - gmail-get-email: Get detailed information about a specific email'
      );
      logger.info(
        '  - gmail-search-emails: Search emails using Gmail query syntax'
      );
      logger.info(
        '  - datetime_converter: Convert date-time strings to different formats'
      );
      logger.info('  - gcalendar-list-calendars: Get a list of all calendars');
      logger.info(
        '  - gcalendar-list-events: Get a list of events from a calendar'
      );
      logger.info(
        '  - gcalendar-create-event: Create a new event in a calendar'
      );
      logger.info(
        '  - gcalendar-decline-event: Decline an invitation to an event'
      );
      logger.info('');
      logger.info(
        'Authentication: Include "Authorization: Bearer <access_token>" header'
      );
      logger.info(
        'Access token should be a valid Google OAuth2 access token with Gmail API scope'
      );
    });
  }
}

// Start the server
const server = new McpServerApp();
server.run().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});

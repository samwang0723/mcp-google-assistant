import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import type {
  CalendarListEntry,
  EventListOptions,
  CreateEventOptions,
  CalendarEvent,
} from '@services/types';
import { GaxiosOptions } from 'gaxios';
import https from 'https';
import logger from '@/utils/logger';
import { GmailServiceOptions } from './gmail';

// Validation schemas
const EventDateTimeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});

export const EventListOptionsSchema = z.object({
  calendarId: z.string().default('primary'),
  maxResults: z.number().min(1).max(2500).optional(),
  pageToken: z.string().optional(),
  timeMin: z.string().optional(),
  timeMax: z.string().optional(),
  query: z.string().optional(),
  singleEvents: z.boolean().optional(),
  orderBy: z.enum(['startTime', 'updated']).optional(),
});

export const CreateEventOptionsSchema = z.object({
  calendarId: z.string().default('primary'),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: EventDateTimeSchema,
  end: EventDateTimeSchema,
  attendees: z.array(z.string().email()).optional(),
  sendNotifications: z.boolean().optional(),
});

export const DeclineEventOptionsSchema = z.object({
  calendarId: z.string().default('primary'),
  eventId: z.string(),
});

export class GCalendarServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GCalendarServiceError';
  }
}

export class GCalendarService {
  private calendar!: calendar_v3.Calendar;
  private oauth2Client!: OAuth2Client;
  private accessToken: string;
  private skipSslVerification: boolean;

  constructor(accessToken: string, options: GmailServiceOptions = {}) {
    if (!accessToken) {
      throw new GCalendarServiceError(
        'Access token is required',
        'MISSING_ACCESS_TOKEN'
      );
    }
    this.accessToken = accessToken;
    this.skipSslVerification = options.skipSslVerification ?? false;
    this.initializeCalendarClient();
  }

  private initializeCalendarClient(): void {
    this.oauth2Client = new OAuth2Client();
    this.oauth2Client.setCredentials({
      access_token: this.accessToken,
    });

    if (this.skipSslVerification) {
      logger.warn(
        'SSL verification is disabled. This is not recommended for production environments.'
      );
    }

    this.calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });
  }

  public updateAccessToken(accessToken: string): void {
    if (!accessToken) {
      throw new GCalendarServiceError(
        'Access token is required',
        'MISSING_ACCESS_TOKEN'
      );
    }
    this.accessToken = accessToken;
    this.initializeCalendarClient();
  }

  static fromBearerToken(
    bearerToken: string,
    options: GmailServiceOptions = {}
  ): GCalendarService {
    if (!bearerToken) {
      throw new GCalendarServiceError(
        'Bearer token is required',
        'MISSING_BEARER_TOKEN'
      );
    }
    const token = bearerToken.startsWith('Bearer ')
      ? bearerToken.substring(7)
      : bearerToken;
    if (!token) {
      throw new GCalendarServiceError(
        'Invalid bearer token format',
        'INVALID_BEARER_TOKEN'
      );
    }
    return new GCalendarService(token, options);
  }

  private getRequestOptions(): GaxiosOptions {
    const options: GaxiosOptions = {};
    if (this.skipSslVerification) {
      options.agent = new https.Agent({ rejectUnauthorized: false });
    }
    return options;
  }

  async listCalendars(): Promise<CalendarListEntry[]> {
    try {
      const response = await this.calendar.calendarList.list(
        {},
        this.getRequestOptions()
      );
      if (!response.data.items) {
        return [];
      }
      return response.data.items.map(item => ({
        id: item.id!,
        summary: item.summary!,
        description: item.description || undefined,
        timeZone: item.timeZone || undefined,
        primary: item.primary || undefined,
      }));
    } catch (error: any) {
      return this.handleCalendarError(error, 'Failed to list calendars');
    }
  }

  async listEvents(
    options: EventListOptions
  ): Promise<{ events: CalendarEvent[]; nextPageToken?: string }> {
    try {
      EventListOptionsSchema.parse(options);
      const requestParams = {
        calendarId: options.calendarId,
        maxResults: options.maxResults,
        pageToken: options.pageToken,
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        q: options.query,
        singleEvents: options.singleEvents ?? true,
        orderBy: options.orderBy ?? 'startTime',
      };

      const response = await this.calendar.events.list(
        requestParams,
        this.getRequestOptions()
      );

      if (!response.data.items) {
        return { events: [] };
      }

      const events: CalendarEvent[] = response.data.items.map(item =>
        this.parseCalendarEvent(item)
      );

      return {
        events,
        nextPageToken: response.data.nextPageToken || undefined,
      };
    } catch (error: any) {
      return this.handleCalendarError(error, 'Failed to list events');
    }
  }

  async createEvent(options: CreateEventOptions): Promise<CalendarEvent> {
    try {
      CreateEventOptionsSchema.parse(options);
      const requestBody: calendar_v3.Schema$Event = {
        summary: options.summary,
        description: options.description,
        location: options.location,
        start: options.start,
        end: options.end,
        attendees: options.attendees?.map(email => ({ email })),
      };

      const requestParams = {
        calendarId: options.calendarId || 'primary',
        requestBody,
        sendNotifications: options.sendNotifications,
      };

      const response = await this.calendar.events.insert(
        requestParams,
        this.getRequestOptions()
      );
      const item = response.data;

      const newEvent: CalendarEvent = this.parseCalendarEvent(item);

      return newEvent;
    } catch (error: any) {
      return this.handleCalendarError(error, 'Failed to create event');
    }
  }

  async declineEvent(options: {
    calendarId?: string;
    eventId: string;
  }): Promise<CalendarEvent> {
    try {
      DeclineEventOptionsSchema.parse(options);
      const { eventId } = options;
      const calendarId = options.calendarId || 'primary';

      // Get user's email from the access token to identify the attendee
      const tokenInfo = await this.oauth2Client.getTokenInfo(this.accessToken);
      if (!tokenInfo.email) {
        throw new GCalendarServiceError(
          'Could not determine user email from token.',
          'USER_EMAIL_NOT_FOUND'
        );
      }
      const userEmail = tokenInfo.email;

      // Get the current event to preserve other attendees' statuses
      const { data: event } = await this.calendar.events.get(
        {
          calendarId,
          eventId,
        },
        this.getRequestOptions()
      );

      const attendees = event.attendees || [];
      let found = false;
      const updatedAttendees = attendees.map(attendee => {
        if (attendee.email === userEmail) {
          found = true;
          return { ...attendee, responseStatus: 'declined' };
        }
        return attendee;
      });

      // If the user was not in the original attendee list (e.g., part of a group), add them.
      if (!found) {
        updatedAttendees.push({ email: userEmail, responseStatus: 'declined' });
      }

      // Patch the event with the updated attendee information
      const response = await this.calendar.events.patch(
        {
          calendarId,
          eventId,
          requestBody: {
            attendees: updatedAttendees,
          },
          sendNotifications: true, // Notify the organizer
        },
        this.getRequestOptions()
      );

      return this.parseCalendarEvent(response.data);
    } catch (error: any) {
      return this.handleCalendarError(error, 'Failed to decline event');
    }
  }

  private parseCalendarEvent(item: calendar_v3.Schema$Event): CalendarEvent {
    return {
      id: item.id!,
      summary: item.summary || 'No Title',
      description: item.description || undefined,
      location: item.location || undefined,
      start: {
        date: item.start?.date ?? undefined,
        dateTime: item.start?.dateTime ?? undefined,
        timeZone: item.start?.timeZone ?? undefined,
      },
      end: {
        date: item.end?.date ?? undefined,
        dateTime: item.end?.dateTime ?? undefined,
        timeZone: item.end?.timeZone ?? undefined,
      },
      attendees: (item.attendees || []).map(a => ({
        email: a.email!,
        displayName: a.displayName || undefined,
        responseStatus: a.responseStatus as
          | 'needsAction'
          | 'declined'
          | 'tentative'
          | 'accepted',
      })),
      organizer: {
        email: item.organizer?.email || undefined,
        displayName: item.organizer?.displayName || undefined,
      },
      hangoutLink: item.hangoutLink || undefined,
      htmlLink: item.htmlLink!,
      status: item.status as 'confirmed' | 'tentative' | 'cancelled',
    };
  }

  private handleCalendarError(error: any, defaultMessage: string): never {
    if (error instanceof z.ZodError) {
      throw new GCalendarServiceError(
        `Invalid input parameters: ${error.errors
          .map(e => e.message)
          .join(', ')}`,
        'VALIDATION_ERROR'
      );
    }
    if (error instanceof GCalendarServiceError) {
      throw error;
    }

    const statusCode = error?.response?.status;
    const errorMessage =
      error?.response?.data?.error?.message ||
      error?.message ||
      'Unknown error';

    switch (statusCode) {
      case 401:
        throw new GCalendarServiceError(
          'Authentication failed. Invalid or expired access token.',
          'AUTHENTICATION_FAILED',
          401
        );
      case 403:
        throw new GCalendarServiceError(
          'Insufficient permissions or quota exceeded.',
          'PERMISSION_DENIED',
          403
        );
      case 404:
        throw new GCalendarServiceError(
          'Calendar or event not found.',
          'NOT_FOUND',
          404
        );
      case 429:
        throw new GCalendarServiceError(
          'Rate limit exceeded. Please try again later.',
          'RATE_LIMIT_EXCEEDED',
          429
        );
      default:
        throw new GCalendarServiceError(
          `${defaultMessage}: ${errorMessage}`,
          'API_ERROR',
          statusCode
        );
    }
  }
}

export default GCalendarService;

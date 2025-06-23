// Types and interfaces for the MCP Google Assistant

export interface EmailListOptions {
  maxResults?: number;
  pageToken?: string;
  query?: string;
  labelIds?: string[]; // Gmail label IDs - defaults to ['INBOX'] if not specified
  includeSpamTrash?: boolean;
}

export interface EmailDetailsOptions {
  messageId: string;
  format?: 'minimal' | 'full' | 'raw' | 'metadata';
  maxWords?: number; // Default: 300, set to 0 for no truncation
  includeHeaders?: string[]; // Specific headers to include, default: ['From', 'Subject', 'Date', 'To']
}

export interface EmailListItem {
  id: string;
  threadId: string;
}

export interface EmailListResponse {
  messages: EmailListItem[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface EmailHeader {
  name: string;
  value: string;
}

export interface EmailDetails {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  textBody: string; // Extracted and potentially truncated text content
  headers: EmailHeader[]; // Filtered headers based on includeHeaders option
}

// Types and interfaces for Google Calendar

export interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
}

export interface EventListOptions {
  calendarId: string; // 'primary' can be used for the primary calendar
  maxResults?: number;
  pageToken?: string;
  timeMin?: string; // ISO 8601 date string, e.g. "2023-12-18T00:00:00Z"
  timeMax?: string; // ISO 8601 date string, e.g. "2023-12-25T23:59:59Z"
  query?: string;
  singleEvents?: boolean; // Expand recurring events, default true
  orderBy?: 'startTime' | 'updated';
}

export interface EventDateTime {
  dateTime?: string; // RFC3339, e.g., '2023-12-25T10:00:00-07:00'
  date?: string; // ISO 8601, e.g., '2023-12-25' for all-day events
  timeZone?: string;
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted';
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: EventAttendee[];
  organizer?: { email?: string; displayName?: string };
  hangoutLink?: string;
  htmlLink: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
}

export interface CreateEventOptions {
  calendarId?: string; // Defaults to 'primary'
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: string[]; // Array of attendee emails
  sendNotifications?: boolean;
}

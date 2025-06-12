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

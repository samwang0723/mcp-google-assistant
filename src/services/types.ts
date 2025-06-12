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
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
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

export interface EmailPart {
  partId: string;
  mimeType: string;
  filename?: string;
  headers?: EmailHeader[];
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: EmailPart[];
}

export interface EmailDetails {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  textBody: string; // Extracted and potentially truncated text content
  wordCount: number; // Original word count before truncation
  isTruncated: boolean; // Whether text was truncated
  headers: EmailHeader[]; // Filtered headers based on includeHeaders option
  sizeEstimate: number;
  raw?: string;
}

// Types and interfaces for the MCP Google Assistant

export interface EmailListOptions {
  maxResults?: number;
  pageToken?: string;
  query?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

export interface EmailDetailsOptions {
  messageId: string;
  format?: 'minimal' | 'full' | 'raw' | 'metadata';
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
  payload: {
    partId: string;
    mimeType: string;
    filename: string;
    headers: EmailHeader[];
    body?: {
      size: number;
      data?: string;
    };
    parts?: EmailPart[];
  };
  sizeEstimate: number;
  raw?: string;
}

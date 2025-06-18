import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import type {
  EmailListOptions,
  EmailDetailsOptions,
  EmailListItem,
  EmailListResponse,
  EmailHeader,
  EmailDetails,
} from '@services/types';
import { GaxiosOptions, GaxiosResponse } from 'gaxios';
import https from 'https';
import logger from '@/utils/logger';

// Validation schemas
export const EmailListOptionsSchema = z.object({
  maxResults: z.number().min(1).max(500).optional(),
  pageToken: z.string().optional(),
  query: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  includeSpamTrash: z.boolean().optional(),
  fetchDetails: z.boolean().optional(),
  includeHeaders: z.array(z.string()).optional(),
});

export const EmailDetailsOptionsSchema = z.object({
  messageId: z.string().min(1),
  format: z.enum(['minimal', 'full', 'raw', 'metadata']).optional(),
  maxWords: z.number().min(0).max(1000).optional(),
  includeHeaders: z.array(z.string()).optional(),
});

export interface GmailServiceOptions {
  skipSslVerification?: boolean;
}

export class GmailServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GmailServiceError';
  }
}

export class GmailService {
  private gmail!: gmail_v1.Gmail; // Definite assignment assertion since it's initialized in initializeGmailClient
  private oauth2Client!: OAuth2Client;
  private accessToken: string;
  private skipSslVerification: boolean;

  constructor(accessToken: string, options: GmailServiceOptions = {}) {
    if (!accessToken) {
      throw new GmailServiceError(
        'Access token is required',
        'MISSING_ACCESS_TOKEN'
      );
    }

    this.accessToken = accessToken;
    this.skipSslVerification = options.skipSslVerification ?? false;
    this.initializeGmailClient();
  }

  private initializeGmailClient(): void {
    // Create OAuth2 client with access token
    this.oauth2Client = new OAuth2Client();
    this.oauth2Client.setCredentials({
      access_token: this.accessToken,
    });

    // We will handle ssl verification manually for each request type
    if (this.skipSslVerification) {
      logger.warn(
        'SSL verification is disabled. This is not recommended for production environments.'
      );
    }

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Update the access token and reinitialize the Gmail client
   * @param accessToken - New Google OAuth2 access token
   */
  public updateAccessToken(accessToken: string): void {
    if (!accessToken) {
      throw new GmailServiceError(
        'Access token is required',
        'MISSING_ACCESS_TOKEN'
      );
    }

    this.accessToken = accessToken;
    this.initializeGmailClient();
  }

  /**
   * Create a GmailService instance from a Bearer token
   * @param bearerToken - Bearer token in format "Bearer <token>" or just the token
   * @returns GmailService instance
   */
  static fromBearerToken(
    bearerToken: string,
    options: GmailServiceOptions = {}
  ): GmailService {
    if (!bearerToken) {
      throw new GmailServiceError(
        'Bearer token is required',
        'MISSING_BEARER_TOKEN'
      );
    }

    // Extract token from "Bearer <token>" format if needed
    const token = bearerToken.startsWith('Bearer ')
      ? bearerToken.substring(7)
      : bearerToken;

    if (!token) {
      throw new GmailServiceError(
        'Invalid bearer token format',
        'INVALID_BEARER_TOKEN'
      );
    }

    return new GmailService(token, options);
  }

  /**
   * Get a list of emails from the user's mailbox
   * @param options - Options for filtering and pagination
   * @returns Promise containing email list and pagination info
   */
  async getEmailList(
    options: EmailListOptions & { fetchDetails?: boolean } = {}
  ): Promise<EmailListResponse> {
    try {
      // Validate input options
      EmailListOptionsSchema.parse(options);

      // Default to INBOX only if no labelIds specified
      const labelIds = options.labelIds ?? ['INBOX'];

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults: options.maxResults ?? 10,
        pageToken: options.pageToken,
        q: options.query,
        labelIds: labelIds,
        includeSpamTrash: options.includeSpamTrash ?? false,
      });

      if (!response.data) {
        throw new GmailServiceError(
          'No data received from Gmail API',
          'NO_DATA_RECEIVED'
        );
      }

      if (options.fetchDetails) {
        const messageIds = (response.data.messages || []).map(
          message => message.id!
        );
        if (messageIds.length === 0) {
          return {
            messages: [],
            nextPageToken: response.data.nextPageToken || undefined,
            resultSizeEstimate: response.data.resultSizeEstimate || 0,
          };
        }

        const messageDetails = await this.batchGetEmailDetails(messageIds);

        return {
          messages: messageDetails,
          nextPageToken: response.data.nextPageToken || undefined,
          resultSizeEstimate: response.data.resultSizeEstimate || 0,
        };
      }

      const messages: EmailListItem[] = (response.data.messages || []).map(
        (message: gmail_v1.Schema$Message) => ({
          id: message.id!,
          threadId: message.threadId!,
        })
      );

      return {
        messages,
        nextPageToken: response.data.nextPageToken || undefined,
        resultSizeEstimate: response.data.resultSizeEstimate || 0,
      };
    } catch (error: any) {
      return this.handleGmailError(error, 'Failed to fetch email list');
    }
  }

  /**
   * Get detailed information for multiple emails in a single batch request.
   * @param messageIds - Array of message IDs to fetch.
   * @returns Promise containing an array of detailed email information.
   */
  private async batchGetEmailDetails(
    messageIds: string[]
  ): Promise<EmailDetails[]> {
    if (messageIds.length === 0) {
      return [];
    }
    if (messageIds.length > 100) {
      // Gmail API batch limit is 100
      throw new GmailServiceError(
        'Cannot batch get more than 100 emails at a time.',
        'BATCH_SIZE_EXCEEDED'
      );
    }

    const boundary = 'batch_boundary';
    const batchRequestBody = messageIds
      .map((id, index) => {
        const getRequest =
          `--${boundary}\r\n` +
          `Content-Type: application/http\r\n` +
          `Content-ID: item-${index}\r\n\r\n` +
          `GET /gmail/v1/users/me/messages/${id}?format=full\r\n`;
        return getRequest;
      })
      .join('');

    const finalRequestBody = `${batchRequestBody}--${boundary}--`;

    try {
      const requestConfig: GaxiosOptions = {
        url: 'https://www.googleapis.com/batch/gmail/v1',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/mixed; boundary=${boundary}`,
        },
        body: finalRequestBody,
      };

      if (this.skipSslVerification) {
        requestConfig.agent = new https.Agent({
          rejectUnauthorized: false,
        });
      }

      const response: GaxiosResponse<any> =
        await this.oauth2Client.request(requestConfig);

      let responseText: string;
      if (typeof response.data === 'string') {
        responseText = response.data;
      } else if (response.data && typeof response.data.text === 'function') {
        // Handle Blob-like response data
        responseText = await response.data.text();
      } else {
        // Handle cases where response.data is neither string nor Blob-like,
        // which is likely a JSON error object from the API.
        const fakeError = {
          response: {
            status: response.status,
            data: response.data,
          },
        };
        return this.handleGmailError(
          fakeError,
          'Failed to batch fetch email details: Unexpected response data type'
        );
      }

      // The boundary in the response can be different from the one in the request.
      // We must parse it from the 'Content-Type' header.
      const contentType =
        response.headers.get('content-type') ||
        response.headers.get('Content-Type');
      if (!contentType || !contentType.includes('boundary=')) {
        // Not a valid multipart response
        return this.handleGmailError(
          { response },
          'Invalid batch response: Missing or malformed Content-Type header'
        );
      }

      const boundaryMatch = contentType.match(/boundary="?([^"]+)"?/);
      if (!boundaryMatch || !boundaryMatch[1]) {
        return this.handleGmailError(
          { response },
          'Invalid batch response: Could not find boundary in Content-Type header'
        );
      }
      const responseBoundary = boundaryMatch[1];

      // Response is a multipart string, we need to parse it
      const parts = responseText
        .split(`--${responseBoundary}`)
        .map(part => part.trim());
      const emailDetailsList: EmailDetails[] = [];

      for (const part of parts) {
        if (part === '' || part === '--') {
          continue;
        }

        // The JSON payload starts at the first '{'.
        const jsonStartIndex = part.indexOf('{');
        if (jsonStartIndex === -1) {
          continue; // Not a valid JSON response part.
        }

        // Extract the JSON string from the part.
        const jsonString = part.substring(jsonStartIndex);

        try {
          const parsedJson = JSON.parse(jsonString);
          if (parsedJson.error) {
            console.error('Error in batch response part:', parsedJson.error);
            continue;
          }

          const message: gmail_v1.Schema$Message = parsedJson;
          const emailDetails = this.parseMessageToEmailDetails(message);
          emailDetailsList.push(emailDetails);
        } catch (e: any) {
          console.error('Failed to parse batch response part:', e);
        }
      }

      return emailDetailsList;
    } catch (error: any) {
      return this.handleGmailError(
        error,
        'Failed to batch fetch email details'
      );
    }
  }

  /**
   * Parses a raw Gmail message object into our EmailDetails format.
   * This is a helper for both getEmailDetails and batchGetEmailDetails.
   * @param message - The raw Gmail message object.
   * @param maxWords - Max words for the body, defaults to 300.
   * @param includeHeaders - Headers to include, defaults to From, Subject, Date, To.
   * @returns The parsed EmailDetails object.
   */
  private parseMessageToEmailDetails(
    message: gmail_v1.Schema$Message,
    maxWords: number = 300,
    includeHeaders: string[] = ['From', 'Subject', 'Date', 'To']
  ): EmailDetails {
    // Extract text content
    const fullTextBody = this.extractTextContent(message);
    const { truncatedText } =
      maxWords > 0
        ? this.truncateText(fullTextBody, maxWords)
        : {
            truncatedText: fullTextBody,
          };

    // Filter headers to only include requested ones
    const allHeaders = (message.payload?.headers || []).map(
      (header: gmail_v1.Schema$MessagePartHeader) => ({
        name: header.name || '',
        value: header.value || '',
      })
    );

    const filteredHeaders = allHeaders.filter(header =>
      includeHeaders.includes(header.name)
    );

    // Build the optimized email details
    const emailDetails: EmailDetails = {
      id: message.id!,
      threadId: message.threadId!,
      snippet: message.snippet || '',
      internalDate: message.internalDate || '',
      textBody: truncatedText,
      headers: filteredHeaders,
    };

    return emailDetails;
  }

  /**
   * Get detailed information about a specific email with optimized payload
   * @param options - Options including message ID, format, and optimization settings
   * @returns Promise containing detailed email information
   */
  async getEmailDetails(options: EmailDetailsOptions): Promise<EmailDetails> {
    try {
      // Validate input options
      EmailDetailsOptionsSchema.parse(options);

      // Set defaults for optimization
      const maxWords = options.maxWords ?? 300;
      const includeHeaders = options.includeHeaders ?? [
        'From',
        'Subject',
        'Date',
        'To',
      ];

      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: options.messageId,
        format: options.format || 'full',
      });

      if (!response.data) {
        throw new GmailServiceError(
          'No data received from Gmail API',
          'NO_DATA_RECEIVED'
        );
      }

      const message = response.data;
      const emailDetails = this.parseMessageToEmailDetails(
        message,
        maxWords,
        includeHeaders
      );

      return emailDetails;
    } catch (error: any) {
      // Handle specific Gmail API errors
      if (error?.response?.status === 404) {
        throw new GmailServiceError(
          `Email with ID ${options.messageId} not found`,
          'EMAIL_NOT_FOUND',
          404
        );
      }

      return this.handleGmailError(error, 'Failed to fetch email details');
    }
  }

  /**
   * Get email headers for quick access to sender, subject, date, etc.
   * @param messageId - The ID of the message
   * @returns Promise containing email headers
   */
  async getEmailHeaders(messageId: string): Promise<EmailHeader[]> {
    try {
      const emailDetails = await this.getEmailDetails({
        messageId,
        format: 'metadata',
        includeHeaders: [], // Get all headers for this method
      });

      return emailDetails.headers;
    } catch (error: any) {
      throw new GmailServiceError(
        `Failed to fetch email headers: ${error.message}`,
        'HEADERS_FETCH_ERROR'
      );
    }
  }

  /**
   * Search emails with a specific query (inbox only by default)
   * @param query - Gmail search query (e.g., "from:example@gmail.com", "is:unread")
   * @param maxResults - Maximum number of results (default: 10, max: 20)
   * @param inboxOnly - Whether to search only in inbox (default: true)
   * @returns Promise containing search results
   */
  async searchEmails(
    query: string,
    maxResults: number = 10,
    inboxOnly: boolean = true
  ): Promise<EmailListResponse> {
    return this.getEmailList({
      query,
      maxResults,
      labelIds: inboxOnly ? ['INBOX'] : undefined,
    });
  }

  /**
   * Get emails from main inbox only
   * @param maxResults - Maximum number of results (default: 10, max: 500)
   * @param pageToken - Token for pagination
   * @returns Promise containing inbox emails
   */
  async getInboxEmails(
    maxResults: number = 10,
    pageToken?: string
  ): Promise<EmailListResponse> {
    return this.getEmailList({
      maxResults,
      pageToken,
      labelIds: ['INBOX'],
    });
  }

  /**
   * Handle Gmail API errors consistently
   */
  private handleGmailError(error: any, defaultMessage: string): never {
    if (error instanceof z.ZodError) {
      throw new GmailServiceError(
        `Invalid input parameters: ${error.errors.map(e => e.message).join(', ')}`,
        'VALIDATION_ERROR'
      );
    }

    if (error instanceof GmailServiceError) {
      throw error;
    }

    const statusCode = error?.response?.status;
    const errorMessage =
      error?.response?.data?.error?.message ||
      error?.message ||
      'Unknown error';

    // Handle common HTTP status codes
    switch (statusCode) {
      case 401:
        throw new GmailServiceError(
          'Authentication failed. Invalid or expired access token.',
          'AUTHENTICATION_FAILED',
          401
        );
      case 403:
        throw new GmailServiceError(
          'Insufficient permissions or quota exceeded.',
          'PERMISSION_DENIED',
          403
        );
      case 429:
        throw new GmailServiceError(
          'Rate limit exceeded. Please try again later.',
          'RATE_LIMIT_EXCEEDED',
          429
        );
      default:
        throw new GmailServiceError(
          `${defaultMessage}: ${errorMessage}`,
          'API_ERROR',
          statusCode
        );
    }
  }

  /**
   * Helper method to decode base64url encoded email content
   * @param data - Base64url encoded string
   * @returns Decoded string
   */
  static decodeBase64Url(data: string): string {
    try {
      // Convert base64url to base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if needed
      const padding = base64.length % 4;
      const paddedBase64 = padding ? base64 + '='.repeat(4 - padding) : base64;

      return Buffer.from(paddedBase64, 'base64').toString('utf-8');
    } catch (error) {
      throw new GmailServiceError(
        'Failed to decode base64url data',
        'DECODE_ERROR'
      );
    }
  }

  /**
   * Extract text content directly from Gmail message response (optimized version)
   * @param message - Gmail message response
   * @returns Plain text content
   */
  private extractTextContent(message: gmail_v1.Schema$Message): string {
    const findTextPart = (
      parts: gmail_v1.Schema$MessagePart[]
    ): string | null => {
      for (const part of parts) {
        // Only process text/plain parts, ignore other mime types
        if (part.mimeType === 'text/plain' && part.body?.data) {
          try {
            return GmailService.decodeBase64Url(part.body.data);
          } catch (error) {
            logger.error('Failed to decode email part:', error);
            continue;
          }
        }
        // Recursively check nested parts
        if (part.parts) {
          const textFromSubParts = findTextPart(part.parts);
          if (textFromSubParts) {
            return textFromSubParts;
          }
        }
      }
      return null;
    };

    // Check if the main payload has text data
    if (
      message.payload?.mimeType === 'text/plain' &&
      message.payload.body?.data
    ) {
      try {
        return GmailService.decodeBase64Url(message.payload.body.data);
      } catch (error) {
        logger.error('Failed to decode main payload:', error);
      }
    }

    // Check parts for text content
    if (message.payload?.parts) {
      const textBody = findTextPart(message.payload.parts);
      if (textBody) {
        return textBody;
      }
    }

    // Fallback to snippet
    return message.snippet || '';
  }

  /**
   * Truncate text to specified word count
   * @param text - Text to truncate
   * @param maxWords - Maximum number of words
   * @returns Object with truncated text, word count, and truncation status
   */
  private truncateText(
    text: string,
    maxWords: number
  ): {
    truncatedText: string;
    wordCount: number;
    isTruncated: boolean;
  } {
    if (!text) {
      return {
        truncatedText: '',
        wordCount: 0,
        isTruncated: false,
      };
    }

    // Split text into words (simple whitespace-based splitting)
    const words = text.trim().split(/\s+/);
    const originalWordCount = words.length;

    if (originalWordCount <= maxWords) {
      return {
        truncatedText: text,
        wordCount: originalWordCount,
        isTruncated: false,
      };
    }

    // Truncate to maxWords and add ellipsis
    const truncatedWords = words.slice(0, maxWords);
    const truncatedText = truncatedWords.join(' ') + '...';

    return {
      truncatedText,
      wordCount: originalWordCount,
      isTruncated: true,
    };
  }
}

export default GmailService;

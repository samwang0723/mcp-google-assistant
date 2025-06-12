import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import type {
  EmailListOptions,
  EmailDetailsOptions,
  EmailListItem,
  EmailListResponse,
  EmailHeader,
  EmailPart,
  EmailDetails,
} from '@services/types';

// Validation schemas
export const EmailListOptionsSchema = z.object({
  maxResults: z.number().min(1).max(500).optional(),
  pageToken: z.string().optional(),
  query: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  includeSpamTrash: z.boolean().optional(),
});

export const EmailDetailsOptionsSchema = z.object({
  messageId: z.string().min(1),
  format: z.enum(['minimal', 'full', 'raw', 'metadata']).optional(),
});

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
  private accessToken: string;

  constructor(accessToken: string) {
    if (!accessToken) {
      throw new GmailServiceError(
        'Access token is required',
        'MISSING_ACCESS_TOKEN'
      );
    }

    this.accessToken = accessToken;
    this.initializeGmailClient();
  }

  private initializeGmailClient(): void {
    // Create OAuth2 client with access token
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({
      access_token: this.accessToken,
    });

    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
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
  static fromBearerToken(bearerToken: string): GmailService {
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

    return new GmailService(token);
  }

  /**
   * Get a list of emails from the user's mailbox
   * @param options - Options for filtering and pagination
   * @returns Promise containing email list and pagination info
   */
  async getEmailList(
    options: EmailListOptions = {}
  ): Promise<EmailListResponse> {
    try {
      // Validate input options
      EmailListOptionsSchema.parse(options);

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults: options.maxResults ?? 10,
        pageToken: options.pageToken,
        q: options.query,
        labelIds: options.labelIds,
        includeSpamTrash: options.includeSpamTrash ?? false,
      });

      if (!response.data) {
        throw new GmailServiceError(
          'No data received from Gmail API',
          'NO_DATA_RECEIVED'
        );
      }

      const messages: EmailListItem[] = (response.data.messages || []).map(
        (message: gmail_v1.Schema$Message) => ({
          id: message.id!,
          threadId: message.threadId!,
          ...(message.labelIds && { labelIds: message.labelIds }),
          ...(message.snippet && { snippet: message.snippet }),
          ...(message.historyId && { historyId: message.historyId }),
          ...(message.internalDate && { internalDate: message.internalDate }),
          ...(message.sizeEstimate && { sizeEstimate: message.sizeEstimate }),
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
   * Get detailed information about a specific email
   * @param options - Options including message ID and format
   * @returns Promise containing detailed email information
   */
  async getEmailDetails(options: EmailDetailsOptions): Promise<EmailDetails> {
    try {
      // Validate input options
      EmailDetailsOptionsSchema.parse(options);

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

      // Transform the response to our typed format
      const emailDetails: EmailDetails = {
        id: message.id!,
        threadId: message.threadId!,
        labelIds: message.labelIds || [],
        snippet: message.snippet || '',
        historyId: message.historyId || '',
        internalDate: message.internalDate || '',
        payload: {
          partId: message.payload?.partId || '',
          mimeType: message.payload?.mimeType || '',
          filename: message.payload?.filename || '',
          headers: (message.payload?.headers || []).map(
            (header: gmail_v1.Schema$MessagePartHeader) => ({
              name: header.name || '',
              value: header.value || '',
            })
          ),
          ...(message.payload?.body && {
            body: {
              size: message.payload.body.size || 0,
              ...(message.payload.body.data && {
                data: message.payload.body.data,
              }),
            },
          }),
          ...(message.payload?.parts && {
            parts: this.transformParts(message.payload.parts),
          }),
        },
        sizeEstimate: message.sizeEstimate || 0,
        ...(message.raw && { raw: message.raw }),
      };

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
      });

      return emailDetails.payload.headers;
    } catch (error: any) {
      throw new GmailServiceError(
        `Failed to fetch email headers: ${error.message}`,
        'HEADERS_FETCH_ERROR'
      );
    }
  }

  /**
   * Search emails with a specific query
   * @param query - Gmail search query (e.g., "from:example@gmail.com", "is:unread")
   * @param maxResults - Maximum number of results (default: 10, max: 500)
   * @returns Promise containing search results
   */
  async searchEmails(
    query: string,
    maxResults: number = 10
  ): Promise<EmailListResponse> {
    return this.getEmailList({
      query,
      maxResults,
    });
  }

  /**
   * Get unread emails
   * @param maxResults - Maximum number of results (default: 10, max: 500)
   * @returns Promise containing unread emails
   */
  async getUnreadEmails(maxResults: number = 10): Promise<EmailListResponse> {
    return this.getEmailList({
      query: 'is:unread',
      maxResults,
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
   * Transform Gmail API parts to our typed format
   */
  private transformParts(parts: gmail_v1.Schema$MessagePart[]): EmailPart[] {
    return parts.map(part => ({
      partId: part.partId || '',
      mimeType: part.mimeType || '',
      ...(part.filename && { filename: part.filename }),
      ...(part.headers && {
        headers: part.headers.map(
          (header: gmail_v1.Schema$MessagePartHeader) => ({
            name: header.name || '',
            value: header.value || '',
          })
        ),
      }),
      ...(part.body && {
        body: {
          ...(part.body.attachmentId && {
            attachmentId: part.body.attachmentId,
          }),
          ...(part.body.size && { size: part.body.size }),
          ...(part.body.data && { data: part.body.data }),
        },
      }),
      ...(part.parts && { parts: this.transformParts(part.parts) }),
    }));
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
   * Extract email body text from email details
   * @param emailDetails - Email details object
   * @returns Plain text body content
   */
  static extractEmailBody(emailDetails: EmailDetails): string {
    const findTextPart = (parts: EmailPart[]): string | null => {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64Url(part.body.data);
        }
        if (part.parts) {
          const textFromSubParts = findTextPart(part.parts);
          if (textFromSubParts) {
            return textFromSubParts;
          }
        }
      }
      return null;
    };

    // First check if the main payload has text data
    if (
      emailDetails.payload.mimeType === 'text/plain' &&
      emailDetails.payload.body?.data
    ) {
      return this.decodeBase64Url(emailDetails.payload.body.data);
    }

    // Then check parts
    if (emailDetails.payload.parts) {
      const textBody = findTextPart(emailDetails.payload.parts);
      if (textBody) {
        return textBody;
      }
    }

    // Fallback to snippet if no text body found
    return emailDetails.snippet || '';
  }
}

export default GmailService;

import { KeyManager } from '../manager/KeyManager.js';
import { ErrorDetails } from '../manager/types.js';
import { logger } from '../utils/logger.js';

// Anthropic Messages API types
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface MessagesRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  system?: string;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
}

export interface MessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export class ProviderError extends Error implements ErrorDetails {
  status?: number;
  headers?: Record<string, string>;

  constructor(message: string, status?: number, headers?: Record<string, string>) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.headers = headers;
  }
}

/**
 * AerolinkClient — wraps the Anthropic Messages API at capi.aerolink.lat.
 * 
 * Uses KeyManager.execute() so key selection, rotation, and cooldown
 * are all handled transparently.
 */
export class AerolinkClient {
  constructor(
    private keyManager: KeyManager,
    private baseUrl: string,
    private defaultModel: string
  ) {
    // Normalize base URL
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public async messages(request: Partial<MessagesRequest> & Pick<MessagesRequest, 'messages'>): Promise<MessagesResponse> {
    const payload: MessagesRequest = {
      model: request.model || this.defaultModel,
      max_tokens: request.max_tokens || 1024,
      messages: request.messages,
    };
    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.system !== undefined) payload.system = request.system;
    if (request.stream !== undefined) payload.stream = request.stream;
    if (request.tools !== undefined) payload.tools = request.tools;
    if (request.tool_choice !== undefined) payload.tool_choice = request.tool_choice;

    return this.keyManager.execute(async (apiKey) => {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      if (!response.ok) {
        let errorMsg = `HTTP Error ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json() as any;
          if (errData?.error?.message) errorMsg = errData.error.message;
        } catch {}

        throw new ProviderError(errorMsg, response.status, responseHeaders);
      }

      const data = await response.json() as MessagesResponse;
      return { data, headers: response.headers };
    });
  }

  /** Convenience alias: chat with user message strings */
  public async chat(messages: Array<{ role: 'user' | 'assistant'; content: string }>, options?: Partial<MessagesRequest>): Promise<MessagesResponse> {
    return this.messages({ ...options, messages });
  }
}

/**
 * xAI API Client
 * Uses OpenAI-style Chat Completions endpoint
 */

export interface XAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface XAIChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: XAIMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Response format types
export type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchemaFormat };

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export class XAIClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.XAI_API_KEY || "";
    this.baseUrl = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
    this.model = process.env.XAI_MODEL || "grok-4-latest";

    if (!this.apiKey) {
      console.error("[XAIClient] XAI_API_KEY is not set!");
      throw new Error("XAI_API_KEY environment variable is required");
    }
    console.log(`[XAIClient] Initialized with baseUrl: ${this.baseUrl}, model: ${this.model}`);
  }

  async chatCompletion(
    messages: XAIMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: ResponseFormat;
    }
  ): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      temperature: options?.temperature ?? 0,
      ...(options?.maxTokens && { max_tokens: options.maxTokens }),
      ...(options?.responseFormat && { response_format: options.responseFormat }),
    };

    try {
      console.log(`[XAIClient] Calling ${url} with model ${this.model}`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[XAIClient] API error: ${response.status} ${response.statusText}`, errorText);
        throw new Error(
          `xAI API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: XAIChatCompletionResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        console.error("[XAIClient] No choices in response:", data);
        throw new Error("No choices in xAI API response");
      }

      const content = data.choices[0].message.content;
      console.log(`[XAIClient] Successfully received response (${content.length} chars)`);
      return content;
    } catch (error) {
      console.error("[XAIClient] Error calling API:", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Unknown error calling xAI API: ${error}`);
    }
  }

  /**
   * Streaming chat completion that yields tokens as they arrive.
   * Returns the full concatenated text as the generator return value.
   */
  async *chatCompletionStream(
    messages: XAIMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: ResponseFormat;
    }
  ): AsyncGenerator<string, string, undefined> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0,
      ...(options?.maxTokens && { max_tokens: options.maxTokens }),
      ...(options?.responseFormat && { response_format: options.responseFormat }),
    };

    console.log(`[XAIClient] Streaming call to ${url} with model ${this.model}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`xAI API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              yield delta;
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    console.log(`[XAIClient] Stream complete (${fullText.length} chars)`);
    return fullText;
  }
}

/**
 * JSON Guard: Validates LLM output with Zod, retries on failure, falls back to template
 * Uses strict JSON Schema enforcement for guaranteed format compliance
 */

import { z, ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { XAIClient, XAIMessage, ResponseFormat } from "./xaiClient";

export interface JSONGuardOptions {
  maxRetries?: number;
  fallbackTemplate?: () => any;
  schemaName?: string; // Name for the JSON schema
}

export class JSONGuard {
  private client: XAIClient;
  private maxRetries: number;
  private fallbackTemplate?: () => any;
  private schemaName: string;

  constructor(options: JSONGuardOptions = {}) {
    this.client = new XAIClient();
    this.maxRetries = options.maxRetries ?? 2;
    this.fallbackTemplate = options.fallbackTemplate;
    this.schemaName = options.schemaName ?? "response";
  }

  /**
   * Calls LLM and validates output against Zod schema
   * Uses strict JSON Schema enforcement at the API level for guaranteed format
   * Falls back to simple JSON mode if strict mode fails
   */
  async callAndValidate<T>(
    prompt: string,
    systemPrompt: string,
    zodSchema: z.ZodSchema<T>,
    input?: any
  ): Promise<T> {
    const messages: XAIMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    // Convert Zod schema to JSON Schema for strict enforcement
    const jsonSchema = zodToJsonSchema(zodSchema, {
      name: this.schemaName,
      $refStrategy: "none", // Inline all refs for compatibility
    });

    // Use strict JSON Schema mode for guaranteed format compliance
    const responseFormat: ResponseFormat = {
      type: "json_schema",
      json_schema: {
        name: this.schemaName,
        schema: jsonSchema as Record<string, unknown>,
        strict: true,
      },
    };

    let lastError: Error | null = null;
    let lastResponse: string = "";

    console.log(`[JSONGuard] Using strict JSON Schema mode for schema: ${this.schemaName}`);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[JSONGuard] Attempt ${attempt + 1}/${this.maxRetries + 1} - Calling xAI API with strict JSON Schema...`);
        const response = await this.client.chatCompletion(messages, { responseFormat });
        lastResponse = response;
        console.log(`[JSONGuard] Received response (length: ${response.length} chars)`);

        // Try to extract JSON from response (might be wrapped in markdown code blocks)
        let jsonString = response.trim();
        
        // Remove markdown code blocks if present
        if (jsonString.startsWith("```json")) {
          jsonString = jsonString.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (jsonString.startsWith("```")) {
          jsonString = jsonString.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }

        const parsed = JSON.parse(jsonString);
        const validated = zodSchema.parse(parsed);

        console.log(`[JSONGuard] Successfully validated JSON on attempt ${attempt + 1}`);
        return validated;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[JSONGuard] Attempt ${attempt + 1} failed:`, {
          error: lastError.message,
          responsePreview: lastResponse.substring(0, 200),
        });

        // If this is the last attempt, try fallback
        if (attempt === this.maxRetries) {
          if (this.fallbackTemplate) {
            console.warn(
              `JSON validation failed after ${this.maxRetries + 1} attempts, using fallback template`,
              lastError
            );
            const fallback = this.fallbackTemplate();
            // Still validate fallback against schema
            return zodSchema.parse(fallback);
          }
          throw new Error(
            `JSON validation failed after ${this.maxRetries + 1} attempts: ${lastError.message}`
          );
        }

        // On retry, add a repair instruction with specific error details
        const errorDetails = lastError instanceof ZodError 
          ? `Schema validation errors:\n${JSON.stringify(lastError.errors.slice(0, 3), null, 2)}\n\nCommon issues:\n- If "tasks" is an array of strings, convert each to an object with: title, type, duration_min, instructions, done_criteria, fallback\n- Ensure all required fields are present\n- Ensure types match (numbers are numbers, not strings)`
          : lastError.message;

        messages.push({
          role: "assistant",
          content: lastResponse || "",
        });
        messages.push({
          role: "user",
          content: `The previous response did not match the required JSON schema. Please fix it and return ONLY valid JSON without any markdown formatting, explanations, or additional text.

${errorDetails}

Return the complete, corrected JSON object now.`,
        });
      }
    }

    throw lastError || new Error("Unexpected error in JSONGuard");
  }

  /**
   * Streaming variant: calls LLM with streaming, forwards tokens via onToken callback,
   * then validates the full response with Zod. Falls back to non-streaming retry on failure.
   */
  async callAndValidateStream<T>(
    prompt: string,
    systemPrompt: string,
    zodSchema: z.ZodSchema<T>,
    onToken: (token: string) => void,
    input?: any
  ): Promise<T> {
    const messages: XAIMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    const jsonSchema = zodToJsonSchema(zodSchema, {
      name: this.schemaName,
      $refStrategy: "none",
    });

    const responseFormat: ResponseFormat = {
      type: "json_schema",
      json_schema: {
        name: this.schemaName,
        schema: jsonSchema as Record<string, unknown>,
        strict: true,
      },
    };

    try {
      console.log(`[JSONGuard] Streaming call with schema: ${this.schemaName}`);
      const gen = this.client.chatCompletionStream(messages, { responseFormat });

      let fullText = "";
      let result = await gen.next();
      while (!result.done) {
        fullText += result.value;
        onToken(result.value);
        result = await gen.next();
      }
      // generator return value is the full text
      if (result.value) fullText = result.value;

      let jsonString = fullText.trim();
      if (jsonString.startsWith("```json")) {
        jsonString = jsonString.replace(/^```json\s*/, "").replace(/\s*```$/, "");
      } else if (jsonString.startsWith("```")) {
        jsonString = jsonString.replace(/^```\s*/, "").replace(/\s*```$/, "");
      }

      const parsed = JSON.parse(jsonString);
      const validated = zodSchema.parse(parsed);
      console.log(`[JSONGuard] Stream validated successfully`);
      return validated;
    } catch (error) {
      console.warn(`[JSONGuard] Stream validation failed, falling back to non-streaming:`, error);
      return this.callAndValidate<T>(prompt, systemPrompt, zodSchema, input);
    }
  }
}

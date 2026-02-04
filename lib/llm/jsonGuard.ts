/**
 * JSON Guard: Validates LLM output with Zod, retries on failure, falls back to template
 */

import { z, ZodError } from "zod";
import { XAIClient, XAIMessage } from "./xaiClient";

export interface JSONGuardOptions {
  maxRetries?: number;
  fallbackTemplate?: () => any;
}

export class JSONGuard {
  private client: XAIClient;
  private maxRetries: number;
  private fallbackTemplate?: () => any;

  constructor(options: JSONGuardOptions = {}) {
    this.client = new XAIClient();
    this.maxRetries = options.maxRetries ?? 2;
    this.fallbackTemplate = options.fallbackTemplate;
  }

  /**
   * Calls LLM and validates output against Zod schema
   * Retries up to maxRetries times, then falls back to template
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

    let lastError: Error | null = null;
    let lastResponse: string = "";

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[JSONGuard] Attempt ${attempt + 1}/${this.maxRetries + 1} - Calling xAI API...`);
        const response = await this.client.chatCompletion(messages);
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
}

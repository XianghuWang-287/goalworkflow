/**
 * DomainExpert Agent
 * Multi-turn conversational agent that asks domain-specific questions
 * to build a detailed GoalSpec through intelligent dialogue.
 */

import { prisma } from "@/lib/prisma";
import { Classification } from "@/lib/schemas/classification";
import {
  ExpertTurnResult,
  ExpertTurnResultSchema,
  ConversationMessage,
} from "@/lib/schemas/conversation";
import { GoalSpecSchema } from "@/lib/schemas/goalSpec";
import { getKnowledge, getKnowledgeForPrompt } from "@/lib/knowledge/provider";
import { XAIClient } from "@/lib/llm/xaiClient";
import type { UserProfile, DomainProfile } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stored inside the Conversation.messages JSON field */
interface ConversationState {
  domain: string;
  goalTitle: string;
  systemPrompt: string;
  turns: ConversationMessage[];
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

const PROMPT_VERSION = "v1.0.0";

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "domain_expert.md");
    const content = readFileSync(promptPath, "utf-8");
    console.log(
      `[DomainExpert] Loaded prompt from ${promptPath} (${content.length} chars)`
    );
    return content;
  } catch (error) {
    console.warn(
      `[DomainExpert] Failed to load prompt file, using fallback:`,
      error
    );
    return `You are a domain expert helping a user define their goal. Ask ONE question at a time to gather information. Return JSON with: message (string), options (optional string array), done (boolean), goalSpec (object when done=true, null otherwise), profileUpdates (optional object).`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUserProfile(
  userProfile: UserProfile | null,
  domainProfile: DomainProfile | null
): string {
  if (!userProfile && !domainProfile) {
    return "No profile data available. You may need to ask about basic schedule and preferences.";
  }

  const parts: string[] = [];

  if (userProfile) {
    if (userProfile.wakeUpTime) parts.push(`Wake-up time: ${userProfile.wakeUpTime}`);
    if (userProfile.sleepTime) parts.push(`Sleep time: ${userProfile.sleepTime}`);
    if (userProfile.timezone) parts.push(`Timezone: ${userProfile.timezone}`);
    if (userProfile.workDays) {
      const days = userProfile.workDays as number[];
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      parts.push(`Work days: ${days.map((d) => dayNames[d] ?? d).join(", ")}`);
    }
    if (userProfile.availableSlots) {
      parts.push(`Available slots: ${JSON.stringify(userProfile.availableSlots)}`);
    }
  }

  if (domainProfile) {
    const data = domainProfile.data as Record<string, unknown>;
    parts.push(`\nDomain profile (${domainProfile.domain}):`);
    for (const [key, value] of Object.entries(data)) {
      parts.push(`  ${key}: ${value}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : "No profile data available.";
}

function formatActiveGoals(
  activeGoals: { id: string; title: string; domain: string | null }[]
): string {
  if (activeGoals.length === 0) {
    return "No other active goals.";
  }
  return activeGoals
    .map((g, i) => `${i + 1}. "${g.title}" (domain: ${g.domain ?? "unknown"})`)
    .join("\n");
}

function buildSystemPrompt(
  promptTemplate: string,
  knowledge: ReturnType<typeof getKnowledge>,
  knowledgeForPrompt: string,
  userProfile: UserProfile | null,
  domainProfile: DomainProfile | null,
  activeGoals: { id: string; title: string; domain: string | null }[],
  conversationHistory: string
): string {
  let prompt = promptTemplate;

  prompt = prompt.replace("{{EXPERT_PERSONA}}", knowledge.expertPersona);
  prompt = prompt.replace("{{DOMAIN_KNOWLEDGE}}", knowledgeForPrompt);
  prompt = prompt.replace(
    "{{USER_PROFILE}}",
    formatUserProfile(userProfile, domainProfile)
  );
  prompt = prompt.replace("{{ACTIVE_GOALS}}", formatActiveGoals(activeGoals));
  prompt = prompt.replace("{{CONVERSATION_HISTORY}}", conversationHistory);

  return prompt;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const MAX_TURNS = 30; // 15 user + 15 assistant

function parseExpertResponse(raw: string): ExpertTurnResult {
  // Strip markdown code fences if the LLM wraps the JSON
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleaned);
  const validated = ExpertTurnResultSchema.parse(parsed);

  // If done=true, validate the goalSpec against GoalSpecSchema
  if (validated.done && validated.goalSpec) {
    try {
      validated.goalSpec = GoalSpecSchema.parse(validated.goalSpec);
      console.log("[DomainExpert] GoalSpec validated successfully");
    } catch (specError) {
      console.warn(
        "[DomainExpert] GoalSpec validation failed, keeping raw spec:",
        specError
      );
      // Keep the raw goalSpec — the caller can decide what to do
    }
  }

  return validated;
}

function makeFallbackTurn(message: string, done: boolean = false): ExpertTurnResult {
  return {
    message,
    done,
    goalSpec: null,
    profileUpdates: undefined,
  };
}

function formatTurnsForHistory(turns: ConversationMessage[]): string {
  if (turns.length === 0) return "No conversation yet — this is the first turn.";
  return turns
    .map((t) => `${t.role === "assistant" ? "Expert" : "User"}: ${t.content}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new expert conversation for a goal.
 * Returns a conversation ID and the first expert turn (question).
 */
export async function startExpertConversation(
  goalTitle: string,
  classification: Classification,
  userProfile: UserProfile | null,
  domainProfile: DomainProfile | null,
  activeGoals: { id: string; title: string; domain: string | null }[]
): Promise<{ conversationId: string; firstTurn: ExpertTurnResult }> {
  console.log(
    `[DomainExpert] Starting conversation for goal: "${goalTitle}" (domain: ${classification.domain})`
  );

  // Load knowledge base for this domain
  const knowledge = getKnowledge(classification.domain);
  const knowledgeForPrompt = getKnowledgeForPrompt(classification.domain);

  // Load and build the system prompt
  const promptTemplate = loadPrompt();
  const systemPrompt = buildSystemPrompt(
    promptTemplate,
    knowledge,
    knowledgeForPrompt,
    userProfile,
    domainProfile,
    activeGoals,
    "No conversation yet — this is the first turn."
  );

  // Build the initial user message
  const userMessage = `The user wants to create a goal: "${goalTitle}"

Classification:
- Domain: ${classification.domain}
- Complexity: ${classification.complexity}
- Plan structure: ${classification.planStructure}
- Suggested duration: ${classification.suggestedDurationDays ?? "not specified"} days

Please introduce yourself briefly and ask your first question to start gathering information for this goal.`;

  // Create conversation record in DB
  const initialState: ConversationState = {
    domain: classification.domain,
    goalTitle,
    systemPrompt,
    turns: [],
  };

  const conversation = await prisma.conversation.create({
    data: {
      goalId: null,
      agentType: "domain_expert",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: initialState as any,
    },
  });

  console.log(
    `[DomainExpert] Created conversation ${conversation.id}`
  );

  // Call LLM
  let firstTurn: ExpertTurnResult;
  try {
    const client = new XAIClient();
    const response = await client.chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        responseFormat: { type: "json_object" },
        temperature: 0.7,
      }
    );

    firstTurn = parseExpertResponse(response);
    console.log(
      `[DomainExpert] First turn parsed (done=${firstTurn.done})`
    );
  } catch (error) {
    console.error("[DomainExpert] Error on first turn:", error);
    firstTurn = makeFallbackTurn(
      `Hi! I'd love to help you with "${goalTitle}". Could you tell me a bit more about what you'd like to achieve and where you're starting from?`
    );
  }

  // Save the turns to the conversation
  const updatedState: ConversationState = {
    ...initialState,
    turns: [
      {
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: JSON.stringify(firstTurn),
        timestamp: new Date().toISOString(),
        options: firstTurn.options,
      },
    ],
  };

  await prisma.conversation.update({
    where: { id: conversation.id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { messages: updatedState as any },
  });

  return { conversationId: conversation.id, firstTurn };
}

/**
 * Continue an existing expert conversation with a user message.
 * Returns the next expert turn.
 */
export async function continueExpertConversation(
  conversationId: string,
  userMessage: string
): Promise<ExpertTurnResult> {
  console.log(
    `[DomainExpert] Continuing conversation ${conversationId}`
  );

  // Load conversation from DB
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    console.error(
      `[DomainExpert] Conversation ${conversationId} not found`
    );
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const state = conversation.messages as unknown as ConversationState;

  if (!state || !state.systemPrompt || !state.turns) {
    console.error(
      `[DomainExpert] Invalid conversation state for ${conversationId}`
    );
    throw new Error(`Invalid conversation state for ${conversationId}`);
  }

  // Add the user message to turns
  const newUserTurn: ConversationMessage = {
    role: "user",
    content: userMessage,
    timestamp: new Date().toISOString(),
  };
  state.turns.push(newUserTurn);

  // Check turn limit — force completion if we hit the cap
  const assistantTurnCount = state.turns.filter(
    (t) => t.role === "assistant"
  ).length;

  if (state.turns.length >= MAX_TURNS) {
    console.warn(
      `[DomainExpert] Turn limit reached (${state.turns.length} turns), forcing completion`
    );

    // Build a forced-completion message
    const forcedTurn = makeFallbackTurn(
      "We've covered a lot of ground! Let me put together your goal plan based on everything we've discussed.",
      true
    );

    // Save and return
    state.turns.push({
      role: "assistant",
      content: JSON.stringify(forcedTurn),
      timestamp: new Date().toISOString(),
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { messages: state as any },
    });

    return forcedTurn;
  }

  // Build the XAI messages array: system + all turns
  const xaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: state.systemPrompt },
  ];

  for (const turn of state.turns) {
    if (turn.role === "assistant") {
      // The assistant content is stored as JSON string of ExpertTurnResult;
      // send just the message portion to keep context clean, but also
      // include the full JSON so the LLM knows what it said
      xaiMessages.push({ role: "assistant", content: turn.content });
    } else {
      xaiMessages.push({ role: "user", content: turn.content });
    }
  }

  // Call LLM
  let expertTurn: ExpertTurnResult;
  try {
    const client = new XAIClient();
    const response = await client.chatCompletion(xaiMessages, {
      responseFormat: { type: "json_object" },
      temperature: 0.7,
    });

    expertTurn = parseExpertResponse(response);
    console.log(
      `[DomainExpert] Turn parsed (done=${expertTurn.done}, turn #${assistantTurnCount + 1})`
    );
  } catch (error) {
    console.error("[DomainExpert] Error on continue turn:", error);

    // If JSON parsing failed, try one retry with explicit instruction
    try {
      console.log("[DomainExpert] Retrying with explicit JSON instruction");
      const retryMessages = [
        ...xaiMessages,
        {
          role: "user" as const,
          content:
            "Please respond with ONLY a valid JSON object containing: message (string), done (boolean), goalSpec (object or null), and optionally options (string array) and profileUpdates (object). No markdown, no code blocks.",
        },
      ];

      const client = new XAIClient();
      const retryResponse = await client.chatCompletion(retryMessages, {
        responseFormat: { type: "json_object" },
        temperature: 0.7,
      });

      expertTurn = parseExpertResponse(retryResponse);
      console.log("[DomainExpert] Retry succeeded");
    } catch (retryError) {
      console.error("[DomainExpert] Retry also failed:", retryError);
      expertTurn = makeFallbackTurn(
        "I appreciate your input! Could you tell me a bit more so I can refine the plan?"
      );
    }
  }

  // If done=true and goalSpec present, validate with GoalSpecSchema
  if (expertTurn.done && expertTurn.goalSpec) {
    try {
      expertTurn.goalSpec = GoalSpecSchema.parse(expertTurn.goalSpec);
      console.log("[DomainExpert] Final GoalSpec validated successfully");
    } catch (specError) {
      console.warn(
        "[DomainExpert] Final GoalSpec validation warning (keeping raw):",
        specError
      );
    }
  }

  // Save assistant turn
  state.turns.push({
    role: "assistant",
    content: JSON.stringify(expertTurn),
    timestamp: new Date().toISOString(),
    options: expertTurn.options,
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { messages: state as any },
  });

  console.log(
    `[DomainExpert] Conversation ${conversationId} updated (${state.turns.length} total turns)`
  );

  return expertTurn;
}

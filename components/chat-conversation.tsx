"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  role: "assistant" | "user";
  content: string;
  options?: string[];
}

interface ChatConversationProps {
  conversationId: string;
  initialMessage: {
    message: string;
    options?: string[];
  };
  onComplete: (goalSpec: any, classification: any) => void;
}

/** Parse SSE lines from a text chunk, returning parsed events and remaining buffer */
function parseSSEChunk(buffer: string): { events: Record<string, unknown>[]; remaining: string } {
  const events: Record<string, unknown>[] = [];
  const lines = buffer.split("\n");
  const remaining = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(trimmed.slice(6)));
    } catch {
      // skip malformed
    }
  }

  return { events, remaining };
}

export function ChatConversation({
  conversationId,
  initialMessage,
  onComplete,
}: ChatConversationProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: initialMessage.message,
      options: initialMessage.options,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [turnCount, setTurnCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setStreamingContent("");
    setTurnCount((c) => c + 1);

    try {
      const res = await fetch("/api/goals/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text.trim(), stream: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error || "Something went wrong. Please try again." },
        ]);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages((prev) => [...prev, { role: "assistant", content: "Streaming not supported." }]);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEChunk(buffer);
        buffer = remaining;

        for (const event of events) {
          if (event.type === "token") {
            accumulated += event.content as string;
            setStreamingContent(accumulated);
          } else if (event.type === "done") {
            // Conversation continues — finalize message with parsed content
            setStreamingContent("");
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: event.message as string,
                options: event.options as string[] | undefined,
              },
            ]);
          } else if (event.type === "complete") {
            // Expert conversation done — goalSpec ready
            setStreamingContent("");
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: event.message as string,
                options: event.options as string[] | undefined,
              },
            ]);
            onComplete(event.goalSpec, event.classification);
          } else if (event.type === "error") {
            setStreamingContent("");
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: (event.message as string) || "Something went wrong." },
            ]);
          }
        }
      }
    } catch {
      setStreamingContent("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please check your connection and try again." },
      ]);
    } finally {
      setLoading(false);
      setStreamingContent("");
    }
  }, [conversationId, loading, onComplete]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleOptionClick = (option: string) => {
    sendMessage(option);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] max-h-[700px]">
      {/* Progress indicator */}
      <div className="flex items-center justify-between px-1 pb-3">
        <span className="text-xs text-muted-foreground">
          Expert conversation
        </span>
        <span className="text-xs text-muted-foreground">
          Turn {turnCount}
        </span>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4">
        {messages.map((msg, idx) => (
          <div key={idx}>
            <div
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                }`}
              >
                {msg.content}
              </div>
            </div>
            {/* Quick-select options below assistant messages */}
            {msg.role === "assistant" && msg.options && msg.options.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2 ml-1">
                {msg.options.map((option, optIdx) => (
                  <Button
                    key={optIdx}
                    variant="outline"
                    size="sm"
                    className="h-auto py-1.5 px-3 text-xs whitespace-normal text-left"
                    onClick={() => handleOptionClick(option)}
                    disabled={loading}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Streaming message */}
        {loading && streamingContent && (
          <div>
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm whitespace-pre-wrap bg-muted text-foreground">
                {streamingContent}
                <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator (before streaming starts) */}
        {loading && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-muted-foreground">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 pt-3 border-t">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer..."
          disabled={loading}
          className="flex-1"
        />
        <Button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          size="sm"
        >
          {loading ? "..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
"use client";

import { useState, useRef, useEffect } from "react";
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
  const [turnCount, setTurnCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setTurnCount((c) => c + 1);

    try {
      const res = await fetch("/api/goals/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.error || "Something went wrong. Please try again.",
          },
        ]);
        return;
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.message,
        options: data.options,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (data.done) {
        onComplete(data.goalSpec, data.classification);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Network error. Please check your connection and try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

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

        {/* Loading indicator */}
        {loading && (
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
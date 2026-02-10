"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChatConversation } from "@/components/chat-conversation";
import { PlanPreview } from "@/components/plan-preview";

type Step = "input" | "analyzing" | "conversation" | "generating" | "preview";

export default function CreateGoalPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");

  // Classification and conversation state
  const [classification, setClassification] = useState<any>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [firstTurn, setFirstTurn] = useState<any>(null);

  // Plan state
  const [plan, setPlan] = useState<any>(null);
  const [goalSpec, setGoalSpec] = useState<any>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [violations, setViolations] = useState<any[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError("");
    setStep("analyzing");

    try {
      const res = await fetch("/api/goals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category: category || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setClassification(data.classification);

      if (data.classification.needsDeepConversation && data.conversation) {
        // Deep path: show conversation
        setConversationId(data.conversation.conversationId);
        setFirstTurn(data.conversation.firstTurn);
        setStep("conversation");
      } else {
        // Fast path: create goal directly
        setStep("generating");
        const createRes = await fetch("/api/goals/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, category, path: "fast" }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error);

        setPlan(createData.plan);
        setGoalSpec(createData.goalSpec);
        setGoalId(createData.goalId);
        setViolations(createData.violations || []);
        setStep("preview");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
      setStep("input");
    }
  };

  const handleConversationComplete = async (completedGoalSpec: any) => {
    setGoalSpec(completedGoalSpec);
    setStep("generating");

    try {
      const res = await fetch("/api/goals/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category,
          path: "deep",
          goalSpec: completedGoalSpec,
          classification,
          conversationId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setPlan(data.plan);
      setGoalId(data.goalId);
      setViolations(data.violations || []);
      setStep("preview");
    } catch (err: any) {
      setError(err.message || "Failed to generate plan");
      setStep("input");
    }
  };

  const handlePlanModify = async (request: string) => {
    if (!goalId) return;
    const res = await fetch(`/api/goals/${goalId}/plan/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });
    const data = await res.json();
    if (res.ok) {
      setPlan(data.plan);
      setViolations(data.violations || []);
    }
  };

  const handleConfirm = () => {
    if (goalId) {
      router.push(`/goals/${goalId}`);
    }
  };

  // --- Render: Analyzing ---
  if (step === "analyzing") {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
            <p className="text-muted-foreground">Analyzing your goal...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Render: Conversation (deep path) ---
  if (step === "conversation" && conversationId && firstTurn) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStep("input");
              setConversationId(null);
              setFirstTurn(null);
              setClassification(null);
            }}
          >
            &larr; Back
          </Button>
        </div>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              Let&apos;s refine your goal
            </CardTitle>
            <CardDescription>
              Answer a few questions so we can build the best plan for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChatConversation
              conversationId={conversationId}
              initialMessage={firstTurn}
              onComplete={handleConversationComplete}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Render: Generating ---
  if (step === "generating") {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
            <p className="text-muted-foreground">Generating your plan...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  // --- Render: Preview ---
  if (step === "preview" && plan) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <PlanPreview
          plan={plan}
          goalSpec={goalSpec}
          classification={classification}
          violations={violations}
          onConfirm={handleConfirm}
          onModify={handlePlanModify}
        />
      </div>
    );
  }

  // --- Render: Input (default) ---
  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Create New Goal</CardTitle>
          <CardDescription>
            Describe your goal in a few words. Our AI will analyze it and create
            a personalized plan for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Goal Title *</Label>
              <Input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Learn Python, Sleep earlier, Run a 5K"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category (optional)</Label>
              <Input
                id="category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., learning, habit, fitness"
              />
            </div>
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <div className="flex gap-4">
              <Button type="submit" disabled={!title.trim()}>
                Continue
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
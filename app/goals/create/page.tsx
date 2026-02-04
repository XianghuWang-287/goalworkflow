"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoalQuestions, Question } from "@/components/goal-questions";

type Step = "initial" | "questions" | "creating";

export default function CreateGoalPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("initial");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const handleInitialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setAnalyzing(true);

    try {
      // Step 1: Analyze goal and get questions
      const analyzeResponse = await fetch("/api/goals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category: category || undefined,
        }),
      });

      const analysis = await analyzeResponse.json();

      if (!analyzeResponse.ok) {
        setError(analysis.error || "Failed to analyze goal");
        return;
      }

      // If no questions needed, create directly
      if (!analysis.needsMoreInfo || !analysis.questions || analysis.questions.length === 0) {
        await createGoal({});
        return;
      }

      // Show questions
      setQuestions(analysis.questions);
      setStep("questions");
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const createGoal = async (answers: Record<string, string>) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/goals/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category: category || undefined,
          answers, // Include answers from questions
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to create goal");
        setLoading(false);
      } else {
        router.push(`/goals/${data.goalId}`);
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleQuestionsComplete = async (answers: Record<string, string>) => {
    setStep("creating");
    await createGoal(answers);
  };

  const handleQuestionsBack = () => {
    setStep("initial");
    setQuestions([]);
  };

  if (step === "questions") {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <GoalQuestions
          questions={questions}
          onComplete={handleQuestionsComplete}
          onBack={handleQuestionsBack}
          loading={loading}
        />
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Create New Goal</CardTitle>
          <CardDescription>
            Describe your goal in a few words. We'll ask a few questions to create the perfect plan for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInitialSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Goal Title *</Label>
              <Input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Learn Python, Sleep earlier, Drink more water"
                required
                disabled={analyzing}
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
                disabled={analyzing}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-4">
              <Button type="submit" disabled={analyzing || loading}>
                {analyzing
                  ? "Analyzing..."
                  : loading
                  ? "Creating..."
                  : "Continue"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={analyzing || loading}
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

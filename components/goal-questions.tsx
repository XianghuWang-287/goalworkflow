"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface Question {
  question: string;
  type: "text" | "select" | "number";
  field: string;
  suggestions?: string[];
  placeholder?: string;
}

interface GoalQuestionsProps {
  questions: Question[];
  onComplete: (answers: Record<string, string>) => void;
  onBack: () => void;
  loading?: boolean;
}

export function GoalQuestions({
  questions,
  onComplete,
  onBack,
  loading = false,
}: GoalQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const canProceed = answers[currentQuestion.field]?.trim() !== "";

  const handleAnswer = (value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.field]: value,
    }));
  };

  const handleNext = () => {
    if (isLastQuestion) {
      onComplete(answers);
    } else {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex === 0) {
      onBack();
    } else {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    handleAnswer(suggestion);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Let&apos;s refine your goal</CardTitle>
        <CardDescription>
          Question {currentQuestionIndex + 1} of {questions.length}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <Label className="text-lg font-semibold mb-4 block">
              {currentQuestion.question}
            </Label>

            {currentQuestion.type === "select" && currentQuestion.suggestions ? (
              <div className="space-y-2">
                {currentQuestion.suggestions.map((suggestion, idx) => (
                  <Button
                    key={idx}
                    type="button"
                    variant={
                      answers[currentQuestion.field] === suggestion
                        ? "default"
                        : "outline"
                    }
                    className="w-full justify-start"
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
                <div className="pt-2 border-t">
                  <Input
                    type="text"
                    placeholder="Or enter your own..."
                    value={
                      answers[currentQuestion.field] &&
                      !currentQuestion.suggestions?.includes(
                        answers[currentQuestion.field]
                      )
                        ? answers[currentQuestion.field]
                        : ""
                    }
                    onChange={(e) => handleAnswer(e.target.value)}
                    className="mt-2"
                  />
                </div>
              </div>
            ) : currentQuestion.type === "number" ? (
              <Input
                type="number"
                placeholder={currentQuestion.placeholder || "Enter a number"}
                value={answers[currentQuestion.field] || ""}
                onChange={(e) => handleAnswer(e.target.value)}
              />
            ) : (
              <Input
                type="text"
                placeholder={currentQuestion.placeholder || "Enter your answer"}
                value={answers[currentQuestion.field] || ""}
                onChange={(e) => handleAnswer(e.target.value)}
              />
            )}
          </div>

          <div className="flex gap-4 justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={loading}
            >
              {currentQuestionIndex === 0 ? "Back" : "Previous"}
            </Button>
            <Button
              type="button"
              onClick={handleNext}
              disabled={!canProceed || loading}
            >
              {loading
                ? "Creating..."
                : isLastQuestion
                ? "Create Goal"
                : "Next"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

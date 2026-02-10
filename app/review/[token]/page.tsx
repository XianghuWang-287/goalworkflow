"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface WeeklyReviewOption {
  label: string;
  description: string;
  plan_patch: any;
}

interface WeeklyReviewMetrics {
  completion_rate: number;
  total_checkins: number;
  done_count: number;
  partial_count: number;
  missed_count: number;
  streak_days: number;
}

interface ReviewData {
  valid: boolean;
  goal: {
    id: string;
    title: string;
    category: string | null;
  };
  weeklyReview: {
    id: string;
    weekIndex: number;
    metrics: WeeklyReviewMetrics;
    blockers: string[];
    wins: string[];
    options: WeeklyReviewOption[];
  };
}

export default function WeeklyReviewPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReviewData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);

  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch(`/api/weekly-review/token?token=${token}`);
        const result = await res.json();

        if (!res.ok) {
          setError(result.error || "Invalid token");
          setLoading(false);
          return;
        }

        setData(result);
      } catch (err) {
        setError("Failed to load weekly review");
      } finally {
        setLoading(false);
      }
    }

    validateToken();
  }, [token]);

  async function handleChooseOption(optionIndex: number) {
    if (!data) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/weekly-review/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          optionIndex,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error || "Failed to submit choice");
        return;
      }

      setChosenLabel(result.chosenOption);
      setSubmitted(true);
    } catch (err) {
      setError("Failed to submit choice");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your weekly review...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">{error}</p>
            <p className="text-sm text-gray-500">
              This link may have expired or already been used. Please check your latest email for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-purple-50 to-white p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="text-6xl mb-4">🎯</div>
            <CardTitle className="text-purple-600">Plan Updated!</CardTitle>
            <CardDescription>
              You chose &ldquo;{chosenLabel}&rdquo; for your next week
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-gray-600 mb-6">
              Your new 7-day plan has been generated. Keep up the great work with &ldquo;{data?.goal.title}&rdquo;!
            </p>
            <Button
              onClick={() => router.push(`/goals/${data?.goal.id}`)}
              variant="outline"
            >
              View Your New Plan
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = data?.weeklyReview.metrics;
  const completionPercent = metrics ? Math.round(metrics.completion_rate * 100) : 0;
  const completionColor = completionPercent >= 70 ? "text-green-600" : completionPercent >= 40 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white p-4">
      <div className="max-w-2xl mx-auto pt-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Weekly Review</h1>
          <p className="text-gray-600">Week {(data?.weeklyReview.weekIndex || 0) + 1}</p>
        </div>

        {/* Goal Title */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{data?.goal.title}</CardTitle>
            {data?.goal.category && (
              <CardDescription className="capitalize">{data.goal.category}</CardDescription>
            )}
          </CardHeader>
        </Card>

        {/* Metrics Summary */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">This Week&apos;s Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Completion Rate */}
            <div className="text-center mb-6">
              <span className={`text-5xl font-bold ${completionColor}`}>
                {completionPercent}%
              </span>
              <p className="text-gray-500 mt-1">completion rate</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {metrics?.done_count || 0}
                </div>
                <div className="text-sm text-gray-600">Done</div>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">
                  {metrics?.partial_count || 0}
                </div>
                <div className="text-sm text-gray-600">Partial</div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {metrics?.missed_count || 0}
                </div>
                <div className="text-sm text-gray-600">Missed</div>
              </div>
            </div>

            {/* Streak */}
            {metrics && metrics.streak_days > 0 && (
              <div className="mt-4 p-3 bg-purple-50 rounded-lg text-center">
                <span className="text-xl">🔥</span>
                <span className="ml-2 font-medium text-purple-700">
                  {metrics.streak_days} day streak!
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Wins & Blockers */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {/* Wins */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span>🎉</span> Wins
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data?.weeklyReview.wins && data.weeklyReview.wins.length > 0 ? (
                <ul className="space-y-2">
                  {data.weeklyReview.wins.map((win, idx) => (
                    <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-green-500">✓</span>
                      {win}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">Keep going!</p>
              )}
            </CardContent>
          </Card>

          {/* Blockers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span>🚧</span> Blockers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data?.weeklyReview.blockers && data.weeklyReview.blockers.length > 0 ? (
                <ul className="space-y-2">
                  {data.weeklyReview.blockers.map((blocker, idx) => (
                    <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-red-500">•</span>
                      {blocker}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No blockers identified</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Next Week Options */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Choose Your Next Week</CardTitle>
            <CardDescription>
              Select how you want to approach the coming week
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data?.weeklyReview.options.map((option, idx) => {
                const colors = [
                  { bg: "bg-blue-50 hover:bg-blue-100", border: "border-blue-200", text: "text-blue-700" },
                  { bg: "bg-orange-50 hover:bg-orange-100", border: "border-orange-200", text: "text-orange-700" },
                  { bg: "bg-green-50 hover:bg-green-100", border: "border-green-200", text: "text-green-700" },
                ];
                const icons = ["⚖️", "🚀", "🌿"];
                const color = colors[idx];

                return (
                  <button
                    key={idx}
                    onClick={() => handleChooseOption(idx)}
                    disabled={submitting}
                    className={`w-full p-4 rounded-lg border-2 ${color.border} ${color.bg} text-left transition-all disabled:opacity-50`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">{icons[idx]}</span>
                      <span className={`font-bold text-lg ${color.text}`}>
                        {option.label}
                      </span>
                    </div>
                    <p className="text-gray-600 text-sm pl-10">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>This link expires in 24 hours</p>
        </div>
      </div>
    </div>
  );
}

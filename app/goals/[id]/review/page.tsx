"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface WeeklyReviewOption {
  label: string;
  description: string;
  plan_patch: any;
}

interface ReviewData {
  id: string;
  weekIndex: number;
  chosenOption: number | null;
  review: {
    metrics: {
      completion_rate: number;
      total_checkins: number;
      done_count: number;
      partial_count: number;
      missed_count: number;
      streak_days: number;
    };
    blockers: string[];
    wins: string[];
    next_week_options: WeeklyReviewOption[];
  };
}

export default function AuthenticatedReviewPage() {
  const params = useParams();
  const router = useRouter();
  const goalId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReviewData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReview() {
      try {
        const res = await fetch(`/api/weekly-review?goalId=${goalId}`);
        if (!res.ok) {
          const result = await res.json();
          setError(result.error || "Failed to load review");
          return;
        }
        const result = await res.json();
        setData(result.weeklyReview);
      } catch {
        setError("Failed to load weekly review");
      } finally {
        setLoading(false);
      }
    }
    fetchReview();
  }, [goalId]);

  async function handleChooseOption(optionIndex: number) {
    if (!data) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/weekly-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId, optionIndex }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Failed to submit choice");
        return;
      }
      setChosenLabel(result.chosenOption);
      setSubmitted(true);
    } catch {
      setError("Failed to submit choice");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading your weekly review...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">{error}</p>
            <Button variant="outline" onClick={() => router.push(`/goals/${goalId}`)}>
              Back to Goal
            </Button>
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
              Your new 7-day plan has been generated. Keep going!
            </p>
            <Button onClick={() => router.push(`/goals/${goalId}`)} variant="outline">
              View Your New Plan
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data?.chosenOption !== null && data?.chosenOption !== undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle>Review Already Completed</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-gray-600 mb-4">This weekly review has already been acted on.</p>
            <Button onClick={() => router.push(`/goals/${goalId}`)} variant="outline">
              Back to Goal
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = data?.review?.metrics;
  const completionPct = metrics ? Math.round(metrics.completion_rate * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white p-4">
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-purple-800">
            Week {(data?.weekIndex ?? 0) + 1} Review
          </h1>
          <p className="text-gray-600 mt-1">Here&apos;s how your week went</p>
        </div>

        {/* Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-3xl font-bold text-purple-600">{completionPct}%</div>
                <div className="text-xs text-gray-500">Completion</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-600">{metrics?.done_count ?? 0}</div>
                <div className="text-xs text-gray-500">Done</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-orange-600">{metrics?.streak_days ?? 0}</div>
                <div className="text-xs text-gray-500">Streak</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Wins & Blockers */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-lg text-green-700">Wins</CardTitle></CardHeader>
            <CardContent>
              {data?.review?.wins?.length ? (
                <ul className="space-y-2">
                  {data.review.wins.map((w, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-green-500">•</span>{w}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-500">No wins recorded</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg text-red-700">Blockers</CardTitle></CardHeader>
            <CardContent>
              {data?.review?.blockers?.length ? (
                <ul className="space-y-2">
                  {data.review.blockers.map((b, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-red-500">•</span>{b}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-500">No blockers identified</p>}
            </CardContent>
          </Card>
        </div>

        {/* Next Week Options */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Choose Your Next Week</CardTitle>
            <CardDescription>Select how you want to approach the coming week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data?.review?.next_week_options?.map((option, idx) => {
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
                      <span className={`font-bold text-lg ${color.text}`}>{option.label}</span>
                    </div>
                    <p className="text-gray-600 text-sm pl-10">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button variant="outline" onClick={() => router.push(`/goals/${goalId}`)}>
            Back to Goal
          </Button>
        </div>
      </div>
    </div>
  );
}

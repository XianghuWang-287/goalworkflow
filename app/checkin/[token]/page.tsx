"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TaskInfo {
  id: string;
  title: string;
  type: string;
  duration_min: number;
  status: string;
}

interface GoalInfo {
  id: string;
  title: string;
  category: string | null;
}

interface TokenData {
  valid: boolean;
  goal: GoalInfo;
  todayTasks: TaskInfo[];
  existingCheckin: {
    status: string;
    note: string | null;
  } | null;
  purpose: string;
}

type CheckinStatus = "done" | "partial" | "missed";

export default function CheckinLandingPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TokenData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch(`/api/checkin/token?token=${token}`);
        const result = await res.json();

        if (!res.ok) {
          setError(result.error || "Invalid token");
          setLoading(false);
          return;
        }

        setData(result);
        if (result.existingCheckin?.note) {
          setNote(result.existingCheckin.note);
        }
      } catch (err) {
        setError("Failed to validate token");
      } finally {
        setLoading(false);
      }
    }

    validateToken();
  }, [token]);

  async function handleCheckin(status: CheckinStatus) {
    if (!data) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkin/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          status,
          note: note.trim() || undefined,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error || "Failed to submit check-in");
        return;
      }

      setSubmitted(true);
    } catch (err) {
      setError("Failed to submit check-in");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
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
              This link may have expired or already been used. Please check your latest email for a new link, or log in to check in manually.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-green-50 to-white p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="text-6xl mb-4">✅</div>
            <CardTitle className="text-green-600">Check-in Complete!</CardTitle>
            <CardDescription>
              Great job staying on track with &ldquo;{data?.goal.title}&rdquo;
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-gray-600 mb-6">
              Keep up the good work! We&apos;ll send you another reminder tomorrow.
            </p>
            <Button
              onClick={() => router.push(`/goals/${data?.goal.id}`)}
              variant="outline"
            >
              View Goal Details
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4">
      <div className="max-w-lg mx-auto pt-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Daily Check-in</h1>
          <p className="text-gray-600">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Goal Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{data?.goal.title}</CardTitle>
            {data?.goal.category && (
              <CardDescription className="capitalize">
                {data.goal.category}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {data?.todayTasks && data.todayTasks.length > 0 ? (
              <div>
                <h4 className="font-medium mb-3">Today&apos;s Tasks:</h4>
                <div className="space-y-2">
                  {data.todayTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-3 bg-gray-50 rounded-lg border"
                    >
                      <div className="font-medium">{task.title}</div>
                      <div className="text-sm text-gray-500">
                        {task.type} • {task.duration_min} min
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No tasks scheduled for today</p>
            )}
          </CardContent>
        </Card>

        {/* Already checked in notice */}
        {data?.existingCheckin && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">
              You already checked in today as &ldquo;{data.existingCheckin.status}&rdquo;.
              You can update your check-in below.
            </p>
          </div>
        )}

        {/* Note input */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Add a note (optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full p-3 border rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              placeholder="How did it go? Any blockers or wins?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Check-in buttons */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How did you do today?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <Button
                onClick={() => handleCheckin("done")}
                disabled={submitting}
                className="h-20 flex flex-col items-center justify-center bg-green-600 hover:bg-green-700"
              >
                <span className="text-2xl mb-1">✅</span>
                <span>Done</span>
              </Button>
              <Button
                onClick={() => handleCheckin("partial")}
                disabled={submitting}
                className="h-20 flex flex-col items-center justify-center bg-yellow-500 hover:bg-yellow-600"
              >
                <span className="text-2xl mb-1">⚡</span>
                <span>Partial</span>
              </Button>
              <Button
                onClick={() => handleCheckin("missed")}
                disabled={submitting}
                className="h-20 flex flex-col items-center justify-center bg-red-500 hover:bg-red-600"
              >
                <span className="text-2xl mb-1">❌</span>
                <span>Missed</span>
              </Button>
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function WeeklyReviewButton({ goalId }: { goalId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      // Check if a pending review already exists
      const checkRes = await fetch(`/api/weekly-review?goalId=${goalId}`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.weeklyReview && checkData.weeklyReview.chosenOption === null) {
          // Pending review exists, skip generation
          router.push(`/goals/${goalId}/review`);
          return;
        }
      }

      // No pending review — generate a new one
      const res = await fetch("/api/weekly-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to generate review");
        return;
      }
      router.push(`/goals/${goalId}/review`);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleClick} disabled={loading} variant="default">
        {loading ? "Generating..." : "Weekly Review"}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

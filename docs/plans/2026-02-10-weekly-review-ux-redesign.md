# Weekly Review UX Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate "This Week's Review" (actionable, conditional) from "Previous Reviews" (historical, always visible), and fix the review button showing after a review is already completed.

**Architecture:** The goal detail page (`app/goals/[id]/page.tsx`) is a Server Component. We query `weeklyReviews` alongside existing includes. The "This Week Review" button only shows when: (1) current week has enough checkins AND (2) no pending/completed review exists for this week. A new "Review History" card shows all past completed reviews inline — no new pages needed.

**Tech Stack:** Next.js Server Component, Prisma, existing WeeklyReview model, shadcn/ui Card/Button

---

## Current Problems

1. After completing a weekly review + generating new plan, the "Weekly Review" button still shows on the goal detail page (because `allCheckedIn` is still true — it doesn't check if a review already exists)
2. Day 7 might not have a checkin but the button appeared anyway (date offset buffer was too generous)
3. No way to view past weekly review summaries — once you choose an option, the review data is gone from the UI

## Design Decisions

- **No new pages** — Review history renders inline on goal detail as a collapsible card
- **No new API routes** — Add a `GET /api/weekly-review/history?goalId=xxx` or just include `weeklyReviews` in the existing Prisma query on the goal detail page (Server Component, so we query directly)
- **Button state logic** — Server-side: query latest WeeklyReview for this goal. If it exists for current week AND `chosenOption !== null`, hide the button. If it exists but `chosenOption === null`, show "Continue Review" instead. If no review for current week, show "Weekly Review" only when checkins are sufficient.

---

### Task 1: Add weeklyReviews to goal detail query

**Files:**
- Modify: `app/goals/[id]/page.tsx:51-76` (Prisma query)

**Step 1: Add weeklyReviews include to the Prisma query**

In the `prisma.goal.findFirst` call, add `weeklyReviews` to the `include`:

```ts
weeklyReviews: {
  orderBy: { weekIndex: "desc" },
},
```

This goes inside the existing `include: { ... }` block, after `eventLogs`.

**Step 2: Verify the dev server compiles**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/goals/TEST_ID`
Expected: 200 or 302 (redirect if not logged in) — no compile errors in terminal

**Step 3: Commit**

```bash
git add app/goals/[id]/page.tsx
git commit -m "feat: include weeklyReviews in goal detail query"
```

---

### Task 2: Fix review button visibility logic

**Files:**
- Modify: `app/goals/[id]/page.tsx:128-153` (allCheckedIn logic) and line 381 (button render)

**Step 1: Replace the `allCheckedIn` + button logic**

After the existing `allCheckedIn` computation (line 153), add review state detection:

```ts
// Determine weekly review state for current week
const latestReview = goal.weeklyReviews[0]; // ordered by weekIndex desc
const hasReviewForCurrentWeek = latestReview?.weekIndex === currentWeekIdx;
const reviewCompleted = hasReviewForCurrentWeek && latestReview.chosenOption !== null;
const reviewPending = hasReviewForCurrentWeek && latestReview.chosenOption === null;

// Show review button only when:
// 1. Enough checkins for the week
// 2. No completed review for this week yet
const showReviewButton = allCheckedIn && !reviewCompleted;
```

Then change line 381 from:
```tsx
{allCheckedIn && <WeeklyReviewButton goalId={goal.id} />}
```
to:
```tsx
{showReviewButton && (
  <WeeklyReviewButton goalId={goal.id} />
)}
{reviewPending && !allCheckedIn && (
  <Link href={`/goals/${goal.id}/review`}>
    <Button variant="outline">Continue Review</Button>
  </Link>
)}
```

This means:
- If checkins complete + no review done → show "Weekly Review" button (generates + navigates)
- If review generated but not yet chosen (pending) and user navigated away → show "Continue Review" link
- If review completed (option chosen) → hide both buttons

**Step 2: Verify in browser**

1. Navigate to a goal that has a completed weekly review → button should NOT appear
2. Navigate to a goal mid-week → button should NOT appear
3. Navigate to a goal with all checkins but no review → button SHOULD appear

**Step 3: Commit**

```bash
git add app/goals/[id]/page.tsx
git commit -m "fix: hide weekly review button after review is completed"
```

---

### Task 3: Add Review History card to goal detail page

**Files:**
- Modify: `app/goals/[id]/page.tsx` — add a new Card section after "Recent Check-ins"

**Step 1: Add the Review History card**

Insert this JSX after the "Recent Check-ins" Card (after line ~558) and before the "Timeline" Card:

```tsx
{/* ===== Review History ===== */}
{goal.weeklyReviews.length > 0 && (
  <Card className="mb-8">
    <CardHeader>
      <CardTitle>Weekly Reviews</CardTitle>
      <CardDescription>
        {goal.weeklyReviews.length} review{goal.weeklyReviews.length > 1 ? "s" : ""}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {goal.weeklyReviews.map((wr) => {
          const review = wr.reviewJson as any;
          const metrics = review?.metrics;
          const wins = review?.wins ?? [];
          const blockers = review?.blockers ?? [];
          const options = review?.next_week_options ?? [];
          const chosen = wr.chosenOption;

          return (
            <div key={wr.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold">
                  Week {wr.weekIndex + 1} Review
                </span>
                <div className="flex items-center gap-2">
                  {chosen !== null ? (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                      Completed
                    </span>
                  ) : (
                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
                      Pending
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(wr.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Metrics row */}
              {metrics && (
                <div className="flex gap-4 mb-3 text-sm">
                  <span>
                    Completion: <strong>{Math.round(metrics.completion_rate)}%</strong>
                  </span>
                  <span className="text-green-700">
                    Done: {metrics.done_count}
                  </span>
                  <span className="text-yellow-700">
                    Partial: {metrics.partial_count}
                  </span>
                  <span className="text-red-700">
                    Missed: {metrics.missed_count}
                  </span>
                </div>
              )}

              {/* Wins */}
              {wins.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-700">Wins:</span>
                  <span className="text-sm text-gray-600 ml-1">
                    {wins.join(", ")}
                  </span>
                </div>
              )}

              {/* Blockers */}
              {blockers.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-red-700">Blockers:</span>
                  <span className="text-sm text-gray-600 ml-1">
                    {blockers.join(", ")}
                  </span>
                </div>
              )}

              {/* Chosen option */}
              {chosen !== null && options[chosen] && (
                <div className="mt-2 pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    Chosen: <strong>{options[chosen].label}</strong> — {options[chosen].description}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CardContent>
  </Card>
)}
```

**Step 2: Verify in browser**

Navigate to a goal with at least one weekly review → should see "Weekly Reviews" card with metrics, wins, blockers, and chosen option displayed.

**Step 3: Commit**

```bash
git add app/goals/[id]/page.tsx
git commit -m "feat: add review history card to goal detail page"
```

---

### Task 4: Fix checkin count logic for review button

**Files:**
- Modify: `app/goals/[id]/page.tsx:133-153`

The current `allCheckedIn` logic uses a 1-day buffer which can be too generous (showing the button when Day 7 has no checkin). Replace with a simpler approach: count checkins that fall within the plan's active date range, and compare against the number of days that have already elapsed (not total days).

**Step 1: Replace the allCheckedIn computation**

Replace lines 133-153 with:

```ts
// Check if current week's elapsed days all have checkins
const currentWeek = planData?.weeks?.find(
  (w) => w.week_index === currentWeekIdx
);
const currentWeekDays = currentWeek?.days ?? [];
const totalWeekDays = currentWeekDays.length;

// Only count days that have already passed (including today)
const todayStr = today; // already defined above as YYYY-MM-DD
const elapsedDays = currentWeekDays.filter((d) => d.date <= todayStr);
const elapsedWithCheckin = elapsedDays.filter((d) => {
  // Check both exact date and ±1 day for offset tolerance
  const dateObj = new Date(d.date);
  const prevDay = new Date(dateObj);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevStr = prevDay.toISOString().split("T")[0];
  return checkinMap.has(d.date) || checkinMap.has(prevStr);
});
const allCheckedIn =
  elapsedDays.length >= totalWeekDays &&
  elapsedWithCheckin.length >= totalWeekDays &&
  totalWeekDays > 0;
```

Key change: We require ALL days in the week to have elapsed AND all of them to have a matching checkin. This prevents the button from showing when Day 7 hasn't been checked in yet.

**Step 2: Test with simulate-checkins script**

Run: `npx tsx scripts/simulate-checkins.ts`
Then check the goal detail page — button should only appear if every day in the week has a checkin.

**Step 3: Commit**

```bash
git add app/goals/[id]/page.tsx
git commit -m "fix: require all week days to have checkins before showing review button"
```

---

### Task 5: Update WeeklyReviewButton to handle existing pending review

**Files:**
- Modify: `components/WeeklyReviewButton.tsx`

Currently the button always POSTs to generate a new review. If a review already exists (pending, not yet chosen), it should skip generation and go straight to the review page.

**Step 1: Update the click handler**

Replace the `handleClick` function:

```tsx
async function handleClick() {
  setLoading(true);
  setError(null);
  try {
    // First check if a pending review already exists
    const checkRes = await fetch(`/api/weekly-review?goalId=${goalId}`);
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.weeklyReview && checkData.weeklyReview.chosenOption === null) {
        // Pending review exists, go directly to review page
        router.push(`/goals/${goalId}/review`);
        return;
      }
    }

    // No pending review, generate a new one
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
```

**Step 2: Verify**

1. Click "Weekly Review" when no review exists → should POST then navigate
2. Navigate back, click again → should skip POST and go directly to review page

**Step 3: Commit**

```bash
git add components/WeeklyReviewButton.tsx
git commit -m "feat: skip review generation if pending review already exists"
```

---

### Task 6: Final integration test

**Step 1: Reset test data and run full flow**

```bash
npx tsx scripts/simulate-checkins.ts
```

**Step 2: Manual verification checklist**

1. Goal detail page: Day cards show ✓/◐/✗ status indicators
2. "Weekly Review" button appears (all days checked in, no existing review)
3. Click "Weekly Review" → navigates to `/goals/{id}/review`
4. Review page shows metrics, wins, blockers, 3 options
5. Choose an option → success message → redirect to goal detail
6. Back on goal detail: "Weekly Review" button is GONE
7. "Weekly Reviews" history card shows the completed review with chosen option
8. Click "Weekly Review" again (if it somehow shows) → should not generate duplicate

**Step 3: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: weekly review UX redesign - history card, proper button state"
```

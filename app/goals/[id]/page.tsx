import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plan, Day, Task, Phase } from "@/lib/schemas/plan";
import { DeleteGoalButton } from "@/components/DeleteGoalButton";
import { WeeklyReviewButton } from "@/components/WeeklyReviewButton";
import { TaskCard } from "@/components/task-card";
import Link from "next/link";

/* ---------- helpers ---------- */

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

const COMPLEXITY_COLORS: Record<string, string> = {
  simple: "bg-emerald-100 text-emerald-800",
  moderate: "bg-amber-100 text-amber-800",
  complex: "bg-red-100 text-red-800",
};

/* ---------- page ---------- */

export default async function GoalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const goal = await prisma.goal.findFirst({
    where: { id: params.id, userId: session.user.id },
    include: {
      plans: {
        where: { status: "active" },
        orderBy: { version: "desc" },
        take: 1,
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 5,
          },
        },
      },
      tasks: {
        orderBy: { date: "asc" },
      },
      checkins: {
        orderBy: { date: "desc" },
      },
      eventLogs: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      weeklyReviews: {
        orderBy: { weekIndex: "desc" },
      },
    },
  });

  if (!goal) {
    return (
      <div className="container mx-auto px-4 py-8">Goal not found</div>
    );
  }

  const activePlan = goal.plans[0];
  const planData: Plan | null = activePlan
    ? (activePlan.planJson as any as Plan)
    : null;

  const phases: Phase[] = planData?.phases ?? [];
  const currentPhaseIdx = activePlan?.currentPhase ?? 0;
  const currentWeekIdx = activePlan?.currentWeek ?? 0;

  const today = new Date().toISOString().split("T")[0];
  const todayTasks = goal.tasks.filter(
    (task) => task.date.toISOString().split("T")[0] === today,
  );

  // Calculate streak
  const checkins = goal.checkins.sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );
  let streak = 0;
  let checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);

  for (const checkin of checkins) {
    const checkinDate = new Date(checkin.date);
    checkinDate.setHours(0, 0, 0, 0);
    if (checkinDate.getTime() === checkDate.getTime()) {
      if (checkin.status === "done" || checkin.status === "partial") {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    } else if (checkinDate.getTime() < checkDate.getTime()) {
      break;
    }
  }

  // Phase progress helpers
  const totalWeeks = phases.reduce((s, p) => s + p.durationWeeks, 0);
  const weeksBeforeCurrentPhase = phases
    .slice(0, currentPhaseIdx)
    .reduce((s, p) => s + p.durationWeeks, 0);
  const currentPhase = phases[currentPhaseIdx] as Phase | undefined;

  // Checkin status map (date string → status)
  const checkinMap = new Map(
    goal.checkins.map((c) => [c.date.toISOString().split("T")[0], c.status])
  );

  // Check if current week's elapsed days all have checkins
  const currentWeek = planData?.weeks?.find(
    (w) => w.week_index === currentWeekIdx
  );
  const currentWeekDays = currentWeek?.days ?? [];
  const totalWeekDays = currentWeekDays.length;

  // Only count days that have already passed (including today)
  const elapsedDays = currentWeekDays.filter((d) => d.date <= today);
  const elapsedWithCheckin = elapsedDays.filter((d) => {
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

  // Determine weekly review state for current week
  const latestReview = goal.weeklyReviews[0];
  const hasReviewForCurrentWeek = latestReview?.weekIndex === currentWeekIdx;
  const reviewCompleted = hasReviewForCurrentWeek && latestReview.chosenOption !== null;
  const reviewPending = hasReviewForCurrentWeek && latestReview.chosenOption === null;
  const showReviewButton = allCheckedIn && !reviewCompleted;

  // Plan versions
  const planVersions = activePlan?.versions ?? [];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* ===== Header ===== */}
      <div className="mb-8">
        <div className="flex items-start justify-between mb-2">
          <h1 className="text-3xl font-bold">{goal.title}</h1>
          <div className="flex gap-2">
            <Link href="/dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
            <DeleteGoalButton goalId={goal.id} goalTitle={goal.title} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm capitalize">
            {goal.category || "other"}
          </span>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm capitalize">
            {goal.status}
          </span>
          {goal.domain && (
            <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm">
              {goal.domain}
            </span>
          )}
          {goal.complexity && (
            <span
              className={`px-3 py-1 rounded-full text-sm capitalize ${
                COMPLEXITY_COLORS[goal.complexity] ??
                "bg-gray-100 text-gray-800"
              }`}
            >
              {goal.complexity}
            </span>
          )}
          {streak > 0 && (
            <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
              {streak} day streak
            </span>
          )}
        </div>
      </div>

      {/* ===== Phase Progress ===== */}
      {phases.length > 0 && currentPhase && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm text-muted-foreground">
                  Phase {currentPhaseIdx + 1} of {phases.length}
                </span>
                <h3 className="font-semibold text-lg">{currentPhase.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {currentPhase.focus}
                </p>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                Week {currentWeekIdx + 1}
                {totalWeeks > 0 && <> of {totalWeeks}</>}
              </div>
            </div>
            {/* Progress bar */}
            <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-muted">
              {phases.map((phase, idx) => {
                const widthPct = totalWeeks > 0
                  ? (phase.durationWeeks / totalWeeks) * 100
                  : 100 / phases.length;
                const isCurrent = idx === currentPhaseIdx;
                const isCompleted = idx < currentPhaseIdx;
                let fillPct = 0;
                if (isCompleted) fillPct = 100;
                else if (isCurrent && phase.durationWeeks > 0) {
                  const weekInPhase = currentWeekIdx - weeksBeforeCurrentPhase;
                  fillPct = Math.min(
                    ((weekInPhase + 1) / phase.durationWeeks) * 100,
                    100,
                  );
                }
                return (
                  <div
                    key={idx}
                    className="relative h-full"
                    style={{ width: `${widthPct}%` }}
                    title={`${phase.name} (${phase.durationWeeks}w)`}
                  >
                    <div
                      className={`h-full transition-all ${
                        isCompleted
                          ? "bg-green-500"
                          : isCurrent
                          ? "bg-blue-500"
                          : "bg-transparent"
                      }`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            {/* Phase labels */}
            <div className="flex gap-1 mt-1">
              {phases.map((phase, idx) => {
                const widthPct = totalWeeks > 0
                  ? (phase.durationWeeks / totalWeeks) * 100
                  : 100 / phases.length;
                return (
                  <div
                    key={idx}
                    className="text-[10px] text-muted-foreground truncate"
                    style={{ width: `${widthPct}%` }}
                  >
                    {phase.name}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Today's Tasks ===== */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Today&apos;s Tasks</CardTitle>
            <Link href={`/checkin?goalId=${goal.id}`}>
              <Button size="sm">Check In</Button>
            </Link>
          </div>
          <CardDescription>{today}</CardDescription>
        </CardHeader>
        <CardContent>
          {todayTasks.length > 0 ? (
            <div className="space-y-3">
              {todayTasks.map((task) => {
                const meta = task.taskJson as any;
                const timeSlot = task.timeSlot || meta?.timeSlot;
                const specificVals =
                  (task.specificValues as Record<string, any>) ??
                  meta?.specificValues;
                const title = meta?.title ?? "Untitled task";
                return (
                  <div key={task.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {timeSlot && (
                          <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                            {timeSlot}
                          </span>
                        )}
                        <span className="font-medium">{title}</span>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          task.status === "done"
                            ? "bg-green-100 text-green-800"
                            : task.status === "skipped"
                            ? "bg-gray-100 text-gray-600"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {task.status}
                      </span>
                    </div>
                    {/* Specific values */}
                    {specificVals &&
                      typeof specificVals === "object" &&
                      Object.keys(specificVals).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(specificVals)
                            .filter(
                              ([, v]) =>
                                v !== null && v !== undefined && v !== "",
                            )
                            .map(([key, value]) => (
                              <span
                                key={key}
                                className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                              >
                                {typeof value === "object"
                                  ? JSON.stringify(value)
                                  : String(value)}
                              </span>
                            ))}
                        </div>
                      )}
                    {meta?.duration_min && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {meta.duration_min} min
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500">No tasks scheduled for today</p>
          )}
        </CardContent>
      </Card>

      {/* ===== Plan Modification Button ===== */}
      <div className="flex gap-3 mb-8">
        <Link href={`/goals/${goal.id}/modify`}>
          <Button variant="outline" className="gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            跟 AI 调整
          </Button>
        </Link>
        {showReviewButton && <WeeklyReviewButton goalId={goal.id} />}
        {reviewPending && !allCheckedIn && (
          <Link href={`/goals/${goal.id}/review`}>
            <Button variant="outline">Continue Review</Button>
          </Link>
        )}
      </div>

      {/* ===== Plan Overview (Multi-week) ===== */}
      {planData && planData.weeks && planData.weeks.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Plan Overview</CardTitle>
            <CardDescription>
              {planData.weeks.length} week
              {planData.weeks.length > 1 ? "s" : ""} starting{" "}
              {planData.start_date}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {planData.weeks.map((week) => (
                <div key={week.week_index}>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-semibold text-base">
                      Week {week.week_index + 1}
                    </h3>
                    {currentWeekIdx === week.week_index && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {week.days.map((day: Day) => {
                      const dayStatus = checkinMap.get(day.date);
                      const borderColor =
                        dayStatus === "done"
                          ? "border-l-4 border-l-green-500"
                          : dayStatus === "partial"
                          ? "border-l-4 border-l-yellow-500"
                          : dayStatus === "missed"
                          ? "border-l-4 border-l-red-500"
                          : "";
                      return (
                      <div
                        key={day.day_index}
                        className={`border rounded-lg p-3 ${borderColor}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium flex items-center gap-1">
                            Day {day.day_index + 1}
                            {dayStatus === "done" && (
                              <span className="text-green-600" title="Done">✓</span>
                            )}
                            {dayStatus === "partial" && (
                              <span className="text-yellow-600" title="Partial">◐</span>
                            )}
                            {dayStatus === "missed" && (
                              <span className="text-red-600" title="Missed">✗</span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {day.date}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {day.tasks.map((task: Task, tIdx: number) => (
                            <TaskCard
                              key={tIdx}
                              task={task}
                              compact
                            />
                          ))}
                        </div>
                        {day.assessment && (
                          <div className="mt-2 border-t pt-2">
                            <span className="text-xs font-medium text-orange-700">
                              Assessment: {day.assessment.title}
                            </span>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Plan Version History ===== */}
      {planVersions.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Plan Version History</CardTitle>
            <CardDescription>
              Recent changes to your plan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {planVersions.map((pv) => {
                const sourceLabel: Record<string, string> = {
                  generation: "Generated",
                  chat: "AI Chat",
                  direct_edit: "Direct Edit",
                  weekly_review: "Weekly Review",
                };
                return (
                  <div
                    key={pv.id}
                    className="flex items-start gap-3 p-3 border rounded-lg"
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-xs font-semibold shrink-0">
                      v{pv.version}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                          {sourceLabel[pv.changeSource] ?? pv.changeSource}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(new Date(pv.createdAt))}
                        </span>
                      </div>
                      {pv.changeSummary && (
                        <p className="text-sm text-muted-foreground truncate">
                          {pv.changeSummary}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Recent Check-ins ===== */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Recent Check-ins</CardTitle>
        </CardHeader>
        <CardContent>
          {goal.checkins.length > 0 ? (
            <div className="space-y-2">
              {goal.checkins.map((checkin) => (
                <div
                  key={checkin.id}
                  className="flex items-center justify-between p-3 border rounded"
                >
                  <div>
                    <span className="font-medium">
                      {new Date(checkin.date).toLocaleDateString()}
                    </span>
                    {checkin.note && (
                      <p className="text-sm text-gray-600 mt-1">
                        {checkin.note}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-3 py-1 rounded text-sm ${
                      checkin.status === "done"
                        ? "bg-green-100 text-green-800"
                        : checkin.status === "partial"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {checkin.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No check-ins yet</p>
          )}
        </CardContent>
      </Card>

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
                const wins: string[] = review?.wins ?? [];
                const blockers: string[] = review?.blockers ?? [];
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
                    {metrics && (
                      <div className="flex gap-4 mb-3 text-sm">
                        <span>
                          Completion: <strong>{Math.round(metrics.completion_rate)}%</strong>
                        </span>
                        <span className="text-green-700">Done: {metrics.done_count}</span>
                        <span className="text-yellow-700">Partial: {metrics.partial_count}</span>
                        <span className="text-red-700">Missed: {metrics.missed_count}</span>
                      </div>
                    )}
                    {wins.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-medium text-green-700">Wins:</span>
                        <span className="text-sm text-gray-600 ml-1">{wins.join(", ")}</span>
                      </div>
                    )}
                    {blockers.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-medium text-red-700">Blockers:</span>
                        <span className="text-sm text-gray-600 ml-1">{blockers.join(", ")}</span>
                      </div>
                    )}
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

      {/* ===== Timeline ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {goal.eventLogs.length > 0 ? (
            <div className="space-y-3">
              {goal.eventLogs.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 border-l-2 border-blue-200"
                >
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 -ml-1.5" />
                  <div className="flex-1">
                    <div className="font-medium capitalize">
                      {event.type.replace(/_/g, " ")}
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(event.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No events yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

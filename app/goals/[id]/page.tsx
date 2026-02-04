import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plan, Day, Task } from "@/lib/schemas/plan";

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
    where: {
      id: params.id,
      userId: session.user.id,
    },
    include: {
      plans: {
        where: { status: "active" },
        orderBy: { version: "desc" },
        take: 1,
      },
      tasks: {
        orderBy: { date: "asc" },
      },
      checkins: {
        orderBy: { date: "desc" },
        take: 7,
      },
      eventLogs: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!goal) {
    return <div className="container mx-auto px-4 py-8">Goal not found</div>;
  }

  const activePlan = goal.plans[0];
  const planData: Plan | null = activePlan
    ? (activePlan.planJson as any as Plan)
    : null;

  const today = new Date().toISOString().split("T")[0];
  const todayTasks = goal.tasks.filter(
    (task) => task.date.toISOString().split("T")[0] === today
  );

  // Calculate streak
  const checkins = goal.checkins.sort(
    (a, b) => b.date.getTime() - a.date.getTime()
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

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{goal.title}</h1>
        <div className="flex gap-4 items-center">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm capitalize">
            {goal.category || "other"}
          </span>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm capitalize">
            {goal.status}
          </span>
          {streak > 0 && (
            <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
              🔥 {streak} day streak
            </span>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Today's Tasks */}
        <Card>
          <CardHeader>
            <CardTitle>Today's Tasks</CardTitle>
            <CardDescription>
              {todayTasks.length > 0
                ? `${todayTasks.length} tasks for today`
                : "No tasks scheduled for today"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {todayTasks.length > 0 ? (
              <div className="space-y-3">
                {todayTasks.map((task, idx) => {
                  const taskData = task.taskJson as any as Task;
                  return (
                    <div
                      key={task.id}
                      className="p-3 border rounded-lg bg-gray-50"
                    >
                      <h4 className="font-medium mb-1">{taskData.title}</h4>
                      <p className="text-sm text-gray-600 mb-2">
                        {taskData.type} • {taskData.duration_min} min
                      </p>
                      <div className="text-xs text-gray-500">
                        Status: {task.status}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500">No tasks for today</p>
            )}
          </CardContent>
        </Card>

        {/* 7-Day Calendar */}
        <Card>
          <CardHeader>
            <CardTitle>7-Day Plan</CardTitle>
            <CardDescription>Your weekly schedule</CardDescription>
          </CardHeader>
          <CardContent>
            {planData ? (
              <div className="space-y-3">
                {planData.weeks[0].days.map((day, idx) => {
                  const dayCheckin = goal.checkins.find(
                    (c) =>
                      c.date.toISOString().split("T")[0] === day.date
                  );
                  const dayTasks = goal.tasks.filter(
                    (t) => t.date.toISOString().split("T")[0] === day.date
                  );
                  return (
                    <div
                      key={idx}
                      className="p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-medium">Day {day.day_index + 1}</span>
                          <span className="text-sm text-gray-500 ml-2">
                            {new Date(day.date).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-xs px-2 py-1 bg-gray-100 rounded">
                            {day.tasks.length} tasks
                          </span>
                          {dayCheckin && (
                            <span
                              className={`text-xs px-2 py-1 rounded ${
                                dayCheckin.status === "done"
                                  ? "bg-green-100 text-green-800"
                                  : dayCheckin.status === "partial"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {dayCheckin.status}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {day.tasks.slice(0, 2).map((task, taskIdx) => (
                          <div key={taskIdx} className="text-sm text-gray-700">
                            <span className="font-medium">{task.title}</span>
                            <span className="text-gray-500 ml-2">
                              ({task.type} • {task.duration_min}min)
                            </span>
                          </div>
                        ))}
                        {day.tasks.length > 2 && (
                          <div className="text-xs text-gray-500">
                            +{day.tasks.length - 2} more tasks
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500">No plan available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Overview */}
      {planData && planData.weeks.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Week 1 Overview</CardTitle>
            <CardDescription>Summary of this week's learning plan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {planData.weeks[0].days.map((day, idx) => {
                const totalDuration = day.tasks.reduce(
                  (sum, task) => sum + task.duration_min,
                  0
                );
                const taskTypes = day.tasks.map((t) => t.type);
                const uniqueTypes = [...new Set(taskTypes)];
                
                return (
                  <div key={idx} className="p-3 border-l-4 border-blue-500 bg-blue-50 rounded">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-semibold">Day {day.day_index + 1}</span>
                        <span className="text-sm text-gray-600 ml-2">
                          {new Date(day.date).toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        {totalDuration} min total
                      </span>
                    </div>
                    <div className="space-y-1">
                      {day.tasks.map((task, taskIdx) => (
                        <div key={taskIdx} className="text-sm">
                          <span className="font-medium">{task.title}</span>
                          <span className="text-gray-600 ml-2">
                            ({task.type} • {task.duration_min}min)
                          </span>
                        </div>
                      ))}
                    </div>
                    {day.assessment && (
                      <div className="mt-2 pt-2 border-t border-blue-200">
                        <div className="text-sm">
                          <span className="font-medium text-blue-700">Assessment: </span>
                          <span>{day.assessment.title}</span>
                          <span className="text-gray-600 ml-2">
                            ({day.assessment.type})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Goal Timeline Overview */}
      {planData && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Learning Path</CardTitle>
            <CardDescription>
              {(() => {
                const goalSpec = goal.goalSpecJson as any;
                const timeframe = goalSpec?.timeframe || "7 days";
                return `Your ${timeframe} learning journey`;
              })()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
                <h3 className="font-semibold mb-2">Week 1 Focus</h3>
                <p className="text-sm text-gray-700">
                  {planData.weeks[0].days.length > 0 && (
                    <>
                      This week covers:{" "}
                      {planData.weeks[0].days
                        .flatMap((d) => d.tasks)
                        .slice(0, 4)
                        .map((t) => t.title)
                        .join(", ")}
                      {planData.weeks[0].days[0].tasks.length > 2 && "..."}
                    </>
                  )}
                </p>
                <div className="mt-2 text-xs text-gray-600">
                  Total tasks: {planData.weeks[0].days.reduce((sum, d) => sum + d.tasks.length, 0)} • 
                  Estimated time:{" "}
                  {planData.weeks[0].days.reduce(
                    (sum, d) =>
                      sum + d.tasks.reduce((s, t) => s + t.duration_min, 0),
                    0
                  )}{" "}
                  minutes
                </div>
              </div>
              {(() => {
                const goalSpec = goal.goalSpecJson as any;
                const timeframe = goalSpec?.timeframe || "";
                if (timeframe.includes("month") || timeframe.includes("week")) {
                  return (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800">
                        <strong>Note:</strong> This is Week 1 of your {timeframe} plan. 
                        Additional weeks will be generated after you complete your first weekly review.
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Check-ins */}
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
                      <p className="text-sm text-gray-600 mt-1">{checkin.note}</p>
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

      {/* Timeline */}
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
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 -ml-1.5"></div>
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

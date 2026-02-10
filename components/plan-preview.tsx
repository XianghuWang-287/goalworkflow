"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskCard } from "@/components/task-card";

interface PlanPreviewProps {
  plan: any;
  goalSpec?: any;
  classification?: any;
  violations?: any[];
  onConfirm: () => void;
  onModify: (request: string) => Promise<void>;
  loading?: boolean;
}

const DOMAIN_STYLES: Record<string, string> = {
  fitness: "bg-red-100 text-red-800",
  habit: "bg-purple-100 text-purple-800",
  learning: "bg-blue-100 text-blue-800",
  finance: "bg-emerald-100 text-emerald-800",
  career: "bg-amber-100 text-amber-800",
  creative: "bg-pink-100 text-pink-800",
  mental: "bg-teal-100 text-teal-800",
  social: "bg-indigo-100 text-indigo-800",
  lifestyle: "bg-cyan-100 text-cyan-800",
  quit: "bg-rose-100 text-rose-800",
  general: "bg-gray-100 text-gray-800",
};

const COMPLEXITY_STYLES: Record<string, string> = {
  simple: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  complex: "bg-red-100 text-red-800",
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function PlanPreview({
  plan,
  goalSpec,
  classification,
  violations,
  onConfirm,
  onModify,
  loading,
}: PlanPreviewProps) {
  const [modifyInput, setModifyInput] = useState("");
  const [modifying, setModifying] = useState(false);
  const [showModifyInput, setShowModifyInput] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(0);

  const weeks = plan?.weeks ?? [];
  const phases = plan?.phases ?? [];
  const currentWeek = weeks[selectedWeek];

  const handleModify = async () => {
    if (!modifyInput.trim()) return;
    setModifying(true);
    try {
      await onModify(modifyInput.trim());
      setModifyInput("");
      setShowModifyInput(false);
    } finally {
      setModifying(false);
    }
  };

  const handleModifyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleModify();
    }
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Goal summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {goalSpec?.title || "Your Plan"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {classification?.domain && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${DOMAIN_STYLES[classification.domain] || DOMAIN_STYLES.general}`}>
                {classification.domain}
              </span>
            )}
            {classification?.complexity && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COMPLEXITY_STYLES[classification.complexity] || ""}`}>
                {classification.complexity}
              </span>
            )}
            {classification?.planStructure && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {classification.planStructure.replace(/_/g, " ")}
              </span>
            )}
            {plan?.totalDurationDays && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {plan.totalDurationDays} days
              </span>
            )}
            {goalSpec?.timeframe && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {goalSpec.timeframe}
              </span>
            )}
          </div>
          {goalSpec?.desiredOutcome && (
            <p className="mt-2 text-sm text-muted-foreground">{goalSpec.desiredOutcome}</p>
          )}
        </CardContent>
      </Card>

      {/* Violations warning */}
      {violations && violations.length > 0 && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="p-4">
            <h4 className="font-medium text-yellow-800 mb-2">Scheduling Notes</h4>
            <ul className="space-y-1">
              {violations.map((v: any, idx: number) => (
                <li key={idx} className="text-sm text-yellow-700 flex items-start gap-1.5">
                  <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-500" />
                  {typeof v === "string" ? v : v.message || v.description || JSON.stringify(v)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Phase overview */}
      {phases.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Phases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {phases.map((phase: any, idx: number) => (
                <div
                  key={idx}
                  className="shrink-0 rounded-lg border p-3 min-w-[160px]"
                >
                  <div className="text-xs text-muted-foreground mb-1">
                    Phase {phase.phaseIndex + 1}
                  </div>
                  <div className="font-medium text-sm">{phase.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {phase.durationWeeks} week{phase.durationWeeks > 1 ? "s" : ""}
                  </div>
                  {phase.focus && (
                    <div className="text-xs text-muted-foreground mt-0.5">{phase.focus}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {/* Week selector */}
      {weeks.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {weeks.map((_: any, idx: number) => (
            <Button
              key={idx}
              variant={selectedWeek === idx ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedWeek(idx)}
            >
              Week {idx + 1}
            </Button>
          ))}
        </div>
      )}

      {/* Day sections with task cards */}
      {currentWeek && currentWeek.days && (
        <div className="space-y-4">
          {currentWeek.days.map((day: any, dayIdx: number) => (
            <div key={dayIdx}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-sm">
                  Day {day.day_index + 1}
                </h3>
                {day.date && (
                  <span className="text-xs text-muted-foreground">
                    {formatDate(day.date)}
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {day.tasks.map((task: any, taskIdx: number) => (
                  <TaskCard key={taskIdx} task={task} />
                ))}
              </div>
              {day.assessment && (
                <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800">
                      {day.assessment.type}
                    </span>
                    <span className="font-medium text-sm">{day.assessment.title}</span>
                  </div>
                  {day.assessment.pass_rule && (
                    <p className="text-xs text-muted-foreground">
                      Pass: {day.assessment.pass_rule}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {(!weeks || weeks.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No plan data available.
          </CardContent>
        </Card>
      )}
      {/* Bottom sticky bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4">
        <div className="container mx-auto max-w-2xl flex items-center gap-3">
          {showModifyInput ? (
            <>
              <Input
                value={modifyInput}
                onChange={(e) => setModifyInput(e.target.value)}
                onKeyDown={handleModifyKeyDown}
                placeholder="Describe what you'd like to change..."
                disabled={modifying}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowModifyInput(false);
                  setModifyInput("");
                }}
                disabled={modifying}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleModify}
                disabled={modifying || !modifyInput.trim()}
              >
                {modifying ? "Modifying..." : "Send"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setShowModifyInput(true)}
                disabled={loading}
              >
                Adjust with AI
              </Button>
              <div className="flex-1" />
              <Button onClick={onConfirm} disabled={loading}>
                {loading ? "Saving..." : "Confirm Plan"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
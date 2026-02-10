"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TaskCardProps {
  task: {
    title: string;
    type: string;
    duration_min: number;
    instructions?: string[];
    timeSlot?: string;
    specificValues?: Record<string, any>;
  };
  onEdit?: () => void;
  onDelete?: () => void;
  compact?: boolean;
}

const TYPE_STYLES: Record<string, string> = {
  learn: "bg-blue-100 text-blue-800",
  practice: "bg-green-100 text-green-800",
  habit: "bg-purple-100 text-purple-800",
  assessment: "bg-orange-100 text-orange-800",
};

export function TaskCard({ task, onEdit, onDelete, compact = false }: TaskCardProps) {
  const typeStyle = TYPE_STYLES[task.type] || "bg-gray-100 text-gray-800";

  const specificEntries = task.specificValues
    ? Object.entries(task.specificValues).filter(
        ([, v]) => v !== null && v !== undefined && v !== "",
      )
    : [];

  if (compact) {
    return (
      <div className="group flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${typeStyle}`}>
            {task.type}
          </span>
          <span className="truncate text-sm font-medium">{task.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{task.duration_min}min</span>
          {(onEdit || onDelete) && (
            <div className="hidden group-hover:flex items-center gap-1">
              {onEdit && (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={onEdit}>
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-destructive" onClick={onDelete}>
                  Del
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="group relative overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        {/* Top row: time slot + type badge */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {task.timeSlot && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                {task.timeSlot}
              </span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${typeStyle}`}>
              {task.type}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{task.duration_min} min</span>
        </div>

        {/* Title */}
        <h4 className="font-semibold text-sm mb-1">{task.title}</h4>

        {/* Specific values as tags */}
        {specificEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {specificEntries.map(([key, value]) => (
              <span
                key={key}
                className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
              >
                {typeof value === "object" ? JSON.stringify(value) : String(value)}
              </span>
            ))}
          </div>
        )}

        {/* Instructions */}
        {task.instructions && task.instructions.length > 0 && (
          <ul className="mt-2 space-y-1">
            {task.instructions.map((instruction, idx) => (
              <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                {instruction}
              </li>
            ))}
          </ul>
        )}

        {/* Hover actions */}
        {(onEdit || onDelete) && (
          <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
            {onEdit && (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onEdit}>
                Edit
              </Button>
            )}
            {onDelete && (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-destructive border-destructive/30" onClick={onDelete}>
                Delete
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

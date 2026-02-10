/**
 * Email Templates
 * HTML templates for various email types
 */

interface Task {
  title: string;
  type: string;
  duration_min: number;
}

interface DailyCheckinEmailData {
  userName: string;
  goalTitle: string;
  checkinUrl: string;
  todayTasks: Task[];
  streak: number;
  phaseProgress?: string; // e.g., "Phase 2/4: Building Strength — Week 3 of 4"
}

interface WeeklyReviewEmailData {
  userName: string;
  goalTitle: string;
  reviewUrl: string;
  weekSummary: {
    completionRate: number;
    doneCount: number;
    partialCount: number;
    missedCount: number;
  };
}

/**
 * Generate daily check-in reminder email
 */
export function generateDailyCheckinEmail(data: DailyCheckinEmailData): { html: string; text: string } {
  const { userName, goalTitle, checkinUrl, todayTasks, streak, phaseProgress } = data;

  const taskListHtml = todayTasks.length > 0
    ? todayTasks
        .map(
          (task) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">
            <strong>${task.title}</strong><br>
            <span style="color: #666; font-size: 14px;">${task.type} • ${task.duration_min} min</span>
          </td>
        </tr>
      `
        )
        .join("")
    : `<tr><td style="padding: 12px; color: #666;">No tasks scheduled for today</td></tr>`;

  const streakText = streak > 0 ? `🔥 You're on a ${streak}-day streak!` : "";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 24px;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Daily Check-in</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Time to track your progress!</p>
  </div>

  <p>Hi ${userName},</p>

  <p>Here's your daily reminder for <strong>${goalTitle}</strong>.</p>

  ${streakText ? `<p style="background: #fef3c7; padding: 12px; border-radius: 8px; text-align: center;">${streakText}</p>` : ""}

  ${phaseProgress ? `<p style="background: #ede9fe; padding: 12px; border-radius: 8px; text-align: center; color: #6d28d9; font-weight: 500;">${phaseProgress}</p>` : ""}

  <h3 style="margin-top: 24px; margin-bottom: 12px;">Today's Tasks:</h3>
  <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 8px; overflow: hidden;">
    ${taskListHtml}
  </table>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${checkinUrl}" style="display: inline-block; background: #10b981; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Check In Now
    </a>
  </div>

  <p style="color: #666; font-size: 14px; text-align: center;">
    This link expires in 24 hours.
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    You're receiving this email because you have an active goal on GoalFlow.<br>
    <a href="#" style="color: #999;">Unsubscribe</a> | <a href="#" style="color: #999;">Manage preferences</a>
  </p>
</body>
</html>
`;

  const taskListText = todayTasks.length > 0
    ? todayTasks.map((task) => `- ${task.title} (${task.type}, ${task.duration_min} min)`).join("\n")
    : "No tasks scheduled for today";

  const text = `
Daily Check-in - ${goalTitle}

Hi ${userName},

Here's your daily reminder for "${goalTitle}".

${streakText}

Today's Tasks:
${taskListText}

Check in now: ${checkinUrl}

This link expires in 24 hours.

---
GoalFlow - AI-Powered Goal Achievement
`;

  return { html, text };
}

/**
 * Generate weekly review email
 */
export function generateWeeklyReviewEmail(data: WeeklyReviewEmailData): { html: string; text: string } {
  const { userName, goalTitle, reviewUrl, weekSummary } = data;
  const { completionRate, doneCount, partialCount, missedCount } = weekSummary;

  const completionPercent = Math.round(completionRate * 100);
  const completionColor = completionPercent >= 70 ? "#10b981" : completionPercent >= 40 ? "#f59e0b" : "#ef4444";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 24px;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Weekly Review</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Let's reflect on your progress!</p>
  </div>

  <p>Hi ${userName},</p>

  <p>It's time for your weekly review of <strong>${goalTitle}</strong>.</p>

  <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin: 24px 0;">
    <h3 style="margin: 0 0 16px 0; text-align: center;">This Week's Summary</h3>

    <div style="text-align: center; margin-bottom: 16px;">
      <span style="font-size: 48px; font-weight: bold; color: ${completionColor};">${completionPercent}%</span>
      <br>
      <span style="color: #666;">completion rate</span>
    </div>

    <table style="width: 100%; text-align: center;">
      <tr>
        <td style="padding: 8px;">
          <div style="font-size: 24px; color: #10b981;">${doneCount}</div>
          <div style="color: #666; font-size: 14px;">Done</div>
        </td>
        <td style="padding: 8px;">
          <div style="font-size: 24px; color: #f59e0b;">${partialCount}</div>
          <div style="color: #666; font-size: 14px;">Partial</div>
        </td>
        <td style="padding: 8px;">
          <div style="font-size: 24px; color: #ef4444;">${missedCount}</div>
          <div style="color: #666; font-size: 14px;">Missed</div>
        </td>
      </tr>
    </table>
  </div>

  <p>Click below to choose your plan for next week:</p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${reviewUrl}" style="display: inline-block; background: #8b5cf6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Start Weekly Review
    </a>
  </div>

  <p style="color: #666; font-size: 14px; text-align: center;">
    This link expires in 24 hours.
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    You're receiving this email because you have an active goal on GoalFlow.<br>
    <a href="#" style="color: #999;">Unsubscribe</a> | <a href="#" style="color: #999;">Manage preferences</a>
  </p>
</body>
</html>
`;

  const text = `
Weekly Review - ${goalTitle}

Hi ${userName},

It's time for your weekly review of "${goalTitle}".

This Week's Summary:
- Completion Rate: ${completionPercent}%
- Done: ${doneCount}
- Partial: ${partialCount}
- Missed: ${missedCount}

Start your weekly review: ${reviewUrl}

This link expires in 24 hours.

---
GoalFlow - AI-Powered Goal Achievement
`;

  return { html, text };
}

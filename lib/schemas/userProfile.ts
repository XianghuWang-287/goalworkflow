import { z } from "zod";

export const TimeSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0=Sun, 6=Sat
  start: z.string(), // "07:00"
  end: z.string(),   // "08:00"
});

export const UserProfileDataSchema = z.object({
  wakeUpTime: z.string().optional(),
  sleepTime: z.string().optional(),
  workDays: z.array(z.number().int().min(0).max(6)).optional(),
  availableSlots: z.array(TimeSlotSchema).optional(),
  timezone: z.string().optional(),
});

export type UserProfileData = z.infer<typeof UserProfileDataSchema>;
export type TimeSlot = z.infer<typeof TimeSlotSchema>;

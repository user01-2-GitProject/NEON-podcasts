export function scheduleError(scheduleTime: string, timezone: string): string | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) {
    return "schedule_time must be HH:MM";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    return "timezone is invalid";
  }

  return null;
}

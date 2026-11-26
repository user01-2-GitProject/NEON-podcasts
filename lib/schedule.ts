export function scheduleError(scheduleTime: string, timezone: string): string | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) {
    return "The time needs to be like 18:00.";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    return "We don't know that time zone. Pick one from the list.";
  }

  return null;
}

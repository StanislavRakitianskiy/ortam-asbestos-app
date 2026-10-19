const dateTime = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" });

/** "2026-10-19T08:05:00.000Z" → "Oct 19, 2026, 11:05 a.m." in the browser's time zone. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export type CalendarEventType = "regular" | "holiday" | "deadline" | "meeting" | "system_week";

export type CalendarEvent = {
  id: string;
  date: string;
  title: string;
  type: CalendarEventType;
  createdAt: string;
  system?: boolean;
};

export const CALENDAR_STORAGE_KEY = "calendar-builder-events-v1";

export const SOUTH_AFRICAN_PUBLIC_HOLIDAYS_2026: Array<{ date: string; title: string }> = [
  { date: "2026-01-01", title: "New Year's Day" },
  { date: "2026-03-21", title: "Human Rights Day" },
  { date: "2026-04-03", title: "Good Friday" },
  { date: "2026-04-06", title: "Family Day" },
  { date: "2026-04-27", title: "Freedom Day" },
  { date: "2026-05-01", title: "Workers' Day" },
  { date: "2026-06-16", title: "Youth Day" },
  { date: "2026-08-09", title: "National Women's Day" },
  { date: "2026-08-10", title: "Public Holiday: Women's Day Observed" },
  { date: "2026-09-24", title: "Heritage Day" },
  { date: "2026-12-16", title: "Day of Reconciliation" },
  { date: "2026-12-25", title: "Christmas Day" },
  { date: "2026-12-26", title: "Day of Goodwill" },
];

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `calendar_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getMondayStart(date: Date) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  const weekday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - weekday);
  return monday;
}

export function getWeekCycleNumber(date: Date) {
  const anchor = new Date(2026, 0, 5);
  anchor.setHours(0, 0, 0, 0);
  const monday = getMondayStart(date);
  const diffDays = Math.round((monday.getTime() - anchor.getTime()) / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);
  return ((((diffWeeks % 4) + 4) % 4) + 1);
}

export function getWeekCycleLabel(date: Date) {
  return `WEEK ${getWeekCycleNumber(date)}`;
}

export function getMonthDays(monthDate: Date) {
  const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startWeekday = (startOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(startOfMonth);
  gridStart.setDate(startOfMonth.getDate() - startWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function loadCalendarEvents() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(CALENDAR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CalendarEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Could not load calendar events:", error);
    return [];
  }
}

export function saveCalendarEvents(events: CalendarEvent[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(events));
  } catch (error) {
    console.error("Could not save calendar events:", error);
  }
}

export function buildSystemCalendarEventsForYear(year: number) {
  const events: CalendarEvent[] = [];
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    events.push({
      id: `system-week-${formatDateKey(cursor)}`,
      date: formatDateKey(cursor),
      title: getWeekCycleLabel(cursor),
      type: "system_week",
      createdAt: new Date(year, 0, 1).toISOString(),
      system: true,
    });
  }

  if (year === 2026) {
    SOUTH_AFRICAN_PUBLIC_HOLIDAYS_2026.forEach((holiday) => {
      events.push({
        id: `holiday-${holiday.date}`,
        date: holiday.date,
        title: holiday.title,
        type: "holiday",
        createdAt: new Date(year, 0, 1).toISOString(),
        system: true,
      });
    });
  }

  return events;
}

export function getCombinedCalendarEvents(years: number[]) {
  const customEvents = loadCalendarEvents();
  const systemEvents = Array.from(new Set(years)).flatMap((year) => buildSystemCalendarEventsForYear(year));
  return [...systemEvents, ...customEvents];
}

export function createCalendarEvent(date: string, title: string, type: CalendarEventType): CalendarEvent {
  return {
    id: randomId(),
    date,
    title,
    type,
    createdAt: new Date().toISOString(),
  };
}

export function getWeekEventForDate(events: CalendarEvent[], dateKey: string) {
  const weekEvent = events.find((event) => event.date === dateKey && /^week\s*[1-4]$/i.test(event.title));
  if (weekEvent) return weekEvent.title.toUpperCase();
  return getWeekCycleLabel(parseDateKey(dateKey));
}

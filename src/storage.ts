import AsyncStorage from "@react-native-async-storage/async-storage";

export type Category = "study" | "work" | "custom";

export interface Task {
  id: string;
  name: string;
  category: Category;
  targetSeconds: number;
  startHour: number; // 0-23
  startMinute: number; // 0-59
  createdAt: number;
  notificationId?: string | null;
}

export interface Session {
  id: string;
  taskId: string;
  taskName: string;
  category: Category;
  targetSeconds: number;
  elapsedSeconds: number;
  diffSeconds: number;
  comment: string;
  startedAt: number;
  completedAt: number;
  date: string; // YYYY-MM-DD
  achievementPct: number; // 0-100, based on target vs elapsed
}

export function computeAchievementPct(targetSec: number, elapsedSec: number): number {
  // Target is the MINIMUM time required. Achievement = elapsed / target * 100.
  // Not capped; staying longer than target is a positive signal.
  if (targetSec <= 0 || elapsedSec <= 0) return 0;
  return Math.max(0, Math.round((elapsedSec / targetSec) * 100));
}

const TASKS_KEY = "@focuszen:tasks";
const SESSIONS_KEY = "@focuszen:sessions";

export async function getTasks(): Promise<Task[]> {
  const raw = await AsyncStorage.getItem(TASKS_KEY);
  return raw ? (JSON.parse(raw) as Task[]) : [];
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export async function upsertTask(task: Task): Promise<Task[]> {
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.unshift(task);
  await saveTasks(tasks);
  return tasks;
}

export async function deleteTask(id: string): Promise<Task[]> {
  const tasks = await getTasks();
  const next = tasks.filter((t) => t.id !== id);
  await saveTasks(next);
  return next;
}

export async function getSessions(): Promise<Session[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  return raw ? (JSON.parse(raw) as Session[]) : [];
}

export async function addSession(session: Session): Promise<Session[]> {
  const sessions = await getSessions();
  sessions.unshift(session);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  return sessions;
}

/**
 * Record a completed run. If a session already exists for the same date and
 * task name, accumulate the elapsed time onto that session and recompute the
 * achievement percentage from the running total. Otherwise insert a new row.
 */
export async function recordCompletion(input: {
  taskId: string;
  taskName: string;
  category: Category;
  targetSeconds: number;
  elapsedSeconds: number;
  comment: string;
  startedAt: number;
  completedAt: number;
}): Promise<Session> {
  const sessions = await getSessions();
  const date = dateKey(new Date());
  const existingIdx = sessions.findIndex(
    (s) => s.date === date && s.taskName === input.taskName,
  );
  let saved: Session;
  if (existingIdx >= 0) {
    const existing = sessions[existingIdx];
    const totalElapsed = existing.elapsedSeconds + input.elapsedSeconds;
    saved = {
      ...existing,
      elapsedSeconds: totalElapsed,
      diffSeconds: totalElapsed - input.targetSeconds,
      targetSeconds: input.targetSeconds,
      comment: input.comment,
      completedAt: input.completedAt,
      achievementPct: computeAchievementPct(input.targetSeconds, totalElapsed),
    };
    sessions[existingIdx] = saved;
  } else {
    saved = {
      id: `${Date.now()}`,
      taskId: input.taskId,
      taskName: input.taskName,
      category: input.category,
      targetSeconds: input.targetSeconds,
      elapsedSeconds: input.elapsedSeconds,
      diffSeconds: input.elapsedSeconds - input.targetSeconds,
      comment: input.comment,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      date,
      achievementPct: computeAchievementPct(
        input.targetSeconds,
        input.elapsedSeconds,
      ),
    };
    sessions.unshift(saved);
  }
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  return saved;
}

export async function deleteSession(id: string): Promise<Session[]> {
  const sessions = await getSessions();
  const next = sessions.filter((s) => s.id !== id);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
  return next;
}

export interface Plan {
  id: string;
  // Display name; also used to merge same-day accumulations in sessions.
  name: string;
  // Optional one-off date (YYYY-MM-DD) when the plan is not recurring.
  date?: string | null;
  // 0=Sun ... 6=Sat; if non-empty the plan recurs on these weekdays.
  weekdays?: number[];
  // "HH:mm" start time (required for scheduling and timer visibility).
  time: string;
  // Minimum time the user commits to work on this plan, in minutes.
  targetMinutes: number;
  // Scheduled notification ids for cancellation.
  reminderIds?: string[];
  createdAt: number;
  // Legacy field kept for migration safety; some old plans used `text`.
  text?: string;
}

export function planMatchesDate(p: Plan, d: Date): boolean {
  const k = dateKey(d);
  if (p.date && p.date === k) return true;
  const wd = d.getDay();
  if (Array.isArray(p.weekdays) && p.weekdays.includes(wd)) return true;
  return false;
}

const PLANS_KEY = "@focuszen:plans";

export async function getPlans(): Promise<Plan[]> {
  const raw = await AsyncStorage.getItem(PLANS_KEY);
  return raw ? (JSON.parse(raw) as Plan[]) : [];
}

export async function addPlan(plan: Plan): Promise<Plan[]> {
  const plans = await getPlans();
  plans.unshift(plan);
  await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(plans));
  return plans;
}

export async function savePlans(plans: Plan[]): Promise<void> {
  await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

export async function deletePlan(id: string): Promise<Plan[]> {
  const plans = await getPlans();
  const next = plans.filter((p) => p.id !== id);
  await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(next));
  return next;
}

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export const categoryLabel: Record<Category, string> = {
  study: "勉強・学習",
  work: "仕事・業務",
  custom: "カスタム",
};

export type Persona = "loli" | "mesugaki" | "sister" | "brother" | "ai" | "oba";

export const personaLabel: Record<Persona, string> = {
  loli: "ロリ",
  mesugaki: "メスガキ",
  sister: "年上の色気のあるお姉さん",
  brother: "お兄さん",
  ai: "事務的AI",
  oba: "おばちゃん",
};

export interface Settings {
  persona: Persona;
  firstPerson?: string;
  ending?: string;
}

const SETTINGS_KEY = "@focuszen:settings";

export const defaultSettings: Settings = {
  persona: "sister",
  firstPerson: "",
  ending: "",
};

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings;
  try {
    return { ...defaultSettings, ...(JSON.parse(raw) as Settings) };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const DAILY_SUMMARY_SHOWN_KEY = "@focuszen:daily-summary-shown";

export async function getLastSummaryDate(): Promise<string | null> {
  return (await AsyncStorage.getItem(DAILY_SUMMARY_SHOWN_KEY)) || null;
}

export async function setLastSummaryDate(date: string): Promise<void> {
  await AsyncStorage.setItem(DAILY_SUMMARY_SHOWN_KEY, date);
}

export interface RunState {
  status: "running" | "paused";
  baseElapsed: number; // seconds
  segmentStart: number | null; // Date.now() when the active segment began
  sessionStart: number;
}

const RUNS_KEY = "@focuszen:runs";

export async function getRuns(): Promise<Record<string, RunState>> {
  const raw = await AsyncStorage.getItem(RUNS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, RunState>;
  } catch {
    return {};
  }
}

export async function saveRuns(runs: Record<string, RunState>): Promise<void> {
  await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
}

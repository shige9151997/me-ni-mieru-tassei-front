import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Persona, Plan, Task } from "./storage";
import {
  getPlans,
  getSettings,
  getTasks,
  saveTasks,
  savePlans,
} from "./storage";

let configured = false;

export async function configureNotifications(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
  } catch {
    // ignore on web
  }
}

export async function requestPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === "granted";
  } catch {
    return false;
  }
}

type ReminderSlot = {
  offset: number; // minutes
  title: (name: string) => string;
  body: string;
};

/**
 * Persona-specific reminder lines. Six slots per persona covering the
 * -10/-5/0/+10/+20/+30 min boundaries.
 */
const PERSONA_LINES: Record<Persona, string[]> = {
  loli: [
    "ねえねえ、あと10ぷんでスタートだよっ。じゅんびしてね。",
    "もうすぐはじまるのっ。あと5ふん、どきどきしてきちゃうよっ。",
    "はじめる時間だよっ、ふぁいとっ！",
    "もう10ぷんすぎてるよ？いっしょにがんばろ？",
    "20ぷんも遅れてるの…ちょっと悲しいもん。",
    "ふーんだ、30ぷんも遅れるなんて、しらないっ。",
  ],
  mesugaki: [
    "あと10分じゃん、まだ始めてないの？ざぁ〜こ、はやく準備しなよ。",
    "もう5分前なんだけど？まだグズグズしてんの、雑魚じゃん。",
    "ほら、始める時間だよ？できないとかナシだからね。",
    "10分も遅れてるとか、本気で雑魚なんだけど。",
    "20分遅れとかマジ無理〜、ざぁ〜こざこ、やる気あるの？",
    "30分遅れとか、もう呆れたんだけど。今日はもう知らないっ。",
  ],
  sister: [
    "あと10分よ…。ゆっくり支度して、お姉さんに素敵なあなたを見せてちょうだい。",
    "もうすぐね…。深呼吸して、心の準備はできたかしら。",
    "さあ、始める時間よ。あなたの頑張り、ちゃんと見てるからね。",
    "あら、10分も過ぎてるわ。少しだけ甘やかしてあげるから、ね。",
    "20分も遅れているのね…。お姉さん、心配になってきちゃう。",
    "はぁ…30分も遅れだなんて、今日は呆れちゃうわ。明日は見せてね。",
  ],
  brother: [
    "あと10分だぞ、準備しとけよ。",
    "5分前だ、気合入れていけ。",
    "時間だ、始めろ。",
    "10分遅れだぞ、何やってんだ。",
    "20分遅れとか、情けねぇぞ。しゃきっとしろ。",
    "30分も遅れとか、呆れたぜ。明日は本気出せ。",
  ],
  ai: [
    "開始時刻の10分前です。準備を開始してください。",
    "開始時刻の5分前です。間もなく開始です。",
    "開始時刻です。タスクを開始してください。",
    "開始から10分経過しました。進捗がありません。開始してください。",
    "開始から20分経過しました。遅延が拡大しています。即座に開始してください。",
    "開始から30分経過しました。本日の予定リマインドを終了します。",
  ],
  oba: [
    "あと10分やで、そろそろ準備しいや。",
    "5分前やで、ほら、しゃきっとしよ。",
    "はじまる時間や、ほんま頼むで。",
    "もう10分遅れとるで、何してんの？",
    "20分遅れやん、お姉ちゃん呆れるで、はよ始めや。",
    "30分も遅れたらあかんで。はぁ、もう呆れたわ。明日はちゃんとしぃや。",
  ],
};

function buildReminderBodies(name: string, persona: Persona): ReminderSlot[] {
  const lines = PERSONA_LINES[persona] ?? PERSONA_LINES.sister;
  const offsets = [-10, -5, 0, 10, 20, 30];
  return offsets.map((offset, i) => ({
    offset,
    title: (n: string) =>
      offset < 0
        ? `${n} まであと${Math.abs(offset)}分`
        : offset === 0
          ? `${n} の開始時刻`
          : `${n} が${offset}分遅れ`,
    body: lines[i] ?? lines[lines.length - 1],
  }));
}

function addOffset(hour: number, minute: number, offsetMin: number): { h: number; m: number } {
  const total = hour * 60 + minute + offsetMin;
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { h: Math.floor(normalized / 60), m: normalized % 60 };
}

async function scheduleOne(
  trigger: Notifications.NotificationTriggerInput,
  title: string,
  body: string,
): Promise<string | null> {
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger,
    });
    return id;
  } catch {
    return null;
  }
}

export async function cancelMany(ids?: (string | null | undefined)[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  for (const id of ids) {
    if (!id) continue;
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // ignore
    }
  }
}

export async function cancel(id?: string | null): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // ignore
  }
}

const DAILY_SUMMARY_ID_KEY = "@focuszen:daily-summary-notif-id";

const DAILY_SUMMARY_LINES: Record<Persona, string> = {
  loli: "きょうもがんばったね。おしまいの時間だよっ、見にきてね。",
  mesugaki: "はい、今日の結果見にきなよ。甘やかしてあげるかどうかは出来次第ね。",
  sister: "今日の達成を見てみましょう…。お姉さんがそっと寄り添ってあげる。",
  brother: "今日の結果だ。しっかり振り返っていけ。",
  ai: "本日の達成サマリーを確認してください。",
  oba: "今日もお疲れさん、ふりかえり見ていきぃや。",
};

export async function ensureDailySummaryNotification(persona: Persona = "sister"): Promise<void> {
  try {
    await configureNotifications();
    const granted = await requestPermission();
    if (!granted) return;
    // Always re-schedule to pick up persona changes.
    const existing = await AsyncStorage.getItem(DAILY_SUMMARY_ID_KEY);
    if (existing) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existing);
      } catch {
        // ignore
      }
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "一日のふりかえり",
        body: DAILY_SUMMARY_LINES[persona] ?? DAILY_SUMMARY_LINES.sister,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 23,
        minute: 50,
      } as Notifications.NotificationTriggerInput,
    });
    if (id) await AsyncStorage.setItem(DAILY_SUMMARY_ID_KEY, id);
  } catch {
    // ignore
  }
}

const WEEKLY_SUMMARY_ID_KEY = "@focuszen:weekly-summary-notif-id";
const MONTHLY_SUMMARY_ID_KEY = "@focuszen:monthly-summary-notif-id";

const WEEKLY_SUMMARY_LINES: Record<Persona, string> = {
  loli: "いっしゅうかんおつかれさま。けっか見にきてねっ。",
  mesugaki: "今週の結果ね。頑張った？それとも雑魚のまま？",
  sister: "今週もお疲れさま…一週間の成果、お姉さんと一緒に眺めましょう。",
  brother: "一週間の成果だ、しっかり見ていけ。",
  ai: "今週の達成サマリーを確認してください。",
  oba: "一週間ごくろうさん、今週の分見てやぁ。",
};

const MONTHLY_SUMMARY_LINES: Record<Persona, string> = {
  loli: "いっかげつもがんばったね。けっか見にきてっ。",
  mesugaki: "今月はどうだった？まぁ結果見ようじゃん。",
  sister: "ひと月もよく頑張ったわね…一緒に振り返りましょう。",
  brother: "ひと月の総括だ、気合入れて見ろ。",
  ai: "今月の達成サマリーを確認してください。",
  oba: "ひと月お疲れさん、今月の分見ていきぃや。",
};

export async function ensureWeeklySummaryNotification(persona: Persona = "sister"): Promise<void> {
  try {
    await configureNotifications();
    const granted = await requestPermission();
    if (!granted) return;
    const existing = await AsyncStorage.getItem(WEEKLY_SUMMARY_ID_KEY);
    if (existing) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existing);
      } catch {}
    }
    // Expo weekday: 1=Sunday ... 7=Saturday; Sunday=1
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "今週のふりかえり",
        body: WEEKLY_SUMMARY_LINES[persona] ?? WEEKLY_SUMMARY_LINES.sister,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 1,
        hour: 23,
        minute: 0,
      } as Notifications.NotificationTriggerInput,
    });
    if (id) await AsyncStorage.setItem(WEEKLY_SUMMARY_ID_KEY, id);
  } catch {
    // ignore
  }
}

export async function ensureMonthlySummaryNotification(persona: Persona = "sister"): Promise<void> {
  try {
    await configureNotifications();
    const granted = await requestPermission();
    if (!granted) return;
    const existing = await AsyncStorage.getItem(MONTHLY_SUMMARY_ID_KEY);
    if (existing) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existing);
      } catch {}
    }
    // Schedule as a one-off DATE trigger on the current month's last day at 22:00.
    // We'll re-schedule after each app open so each month gets its own trigger.
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    let fire = new Date(
      lastDay.getFullYear(),
      lastDay.getMonth(),
      lastDay.getDate(),
      22,
      0,
      0,
      0,
    );
    if (fire.getTime() <= Date.now()) {
      const nextLast = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      fire = new Date(
        nextLast.getFullYear(),
        nextLast.getMonth(),
        nextLast.getDate(),
        22,
        0,
        0,
        0,
      );
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "今月のふりかえり",
        body: MONTHLY_SUMMARY_LINES[persona] ?? MONTHLY_SUMMARY_LINES.sister,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fire,
      } as Notifications.NotificationTriggerInput,
    });
    if (id) await AsyncStorage.setItem(MONTHLY_SUMMARY_ID_KEY, id);
  } catch {
    // ignore
  }
}

const LIVE_ACTIVITY_ID_KEY = "@focuszen:live-activity-notif-id";

/**
 * Present a persistent "running" notification showing the active task name
 * and start time. Updating a notification every second from JS is impractical
 * in Expo Go; instead we post one notification per start/pause/resume event
 * and cancel it on complete. True iOS Live Activity requires a native build.
 */
export async function presentLiveActivity(
  taskName: string,
  startedAtMs: number,
  targetSeconds: number,
): Promise<void> {
  try {
    await configureNotifications();
    const granted = await requestPermission();
    if (!granted) return;
    await dismissLiveActivity();
    const started = new Date(startedAtMs);
    const hh = String(started.getHours()).padStart(2, "0");
    const mm = String(started.getMinutes()).padStart(2, "0");
    const targetMin = Math.floor(targetSeconds / 60);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `計測中: ${taskName}`,
        body: `${hh}:${mm} 開始 · 目標 ${targetMin}分`,
        sticky: true,
        autoDismiss: false,
      } as Notifications.NotificationContentInput,
      trigger: null,
    });
    if (id) await AsyncStorage.setItem(LIVE_ACTIVITY_ID_KEY, id);
  } catch {
    // ignore
  }
}

export async function dismissLiveActivity(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(LIVE_ACTIVITY_ID_KEY);
    if (existing) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existing);
      } catch {}
      try {
        await Notifications.dismissNotificationAsync(existing);
      } catch {}
      await AsyncStorage.removeItem(LIVE_ACTIVITY_ID_KEY);
    }
  } catch {
    // ignore
  }
}

export async function scheduleTaskReminders(task: Task, persona: Persona): Promise<string[]> {
  await configureNotifications();
  const granted = await requestPermission();
  if (!granted) return [];
  const bodies = buildReminderBodies(task.name, persona);
  const ids: string[] = [];
  for (const r of bodies) {
    const { h, m } = addOffset(task.startHour, task.startMinute, r.offset);
    const id = await scheduleOne(
      {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: h,
        minute: m,
      } as Notifications.NotificationTriggerInput,
      r.title(task.name),
      r.body,
    );
    if (id) ids.push(id);
  }
  return ids;
}

export async function schedulePlanReminders(plan: Plan, persona: Persona): Promise<string[]> {
  await configureNotifications();
  const granted = await requestPermission();
  if (!granted) return [];
  const bodies = buildReminderBodies(plan.name, persona);
  const [hh, mm] = plan.time.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return [];
  const ids: string[] = [];
  if (plan.weekdays && plan.weekdays.length > 0) {
    for (const wd of plan.weekdays) {
      const expoWeekday = ((wd + 7) % 7) + 1;
      for (const r of bodies) {
        const { h, m } = addOffset(hh, mm, r.offset);
        const id = await scheduleOne(
          {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: expoWeekday,
            hour: h,
            minute: m,
          } as Notifications.NotificationTriggerInput,
          r.title(plan.name),
          r.body,
        );
        if (id) ids.push(id);
      }
    }
    return ids;
  }
  if (plan.date) {
    const [y, mo, d] = plan.date.split("-").map((v) => parseInt(v, 10));
    for (const r of bodies) {
      const fire = new Date(y, (mo || 1) - 1, d || 1, hh, mm, 0, 0);
      fire.setMinutes(fire.getMinutes() + r.offset);
      if (fire.getTime() <= Date.now()) continue;
      const id = await scheduleOne(
        {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fire,
        } as Notifications.NotificationTriggerInput,
        r.title(plan.name),
        r.body,
      );
      if (id) ids.push(id);
    }
  }
  return ids;
}

/**
 * Re-schedule every task's and plan's reminder flow using the latest persona.
 * Called from the Settings screen on save.
 */
export async function rescheduleAllReminders(): Promise<void> {
  const settings = await getSettings();
  await ensureDailySummaryNotification(settings.persona);
  await ensureWeeklySummaryNotification(settings.persona);
  await ensureMonthlySummaryNotification(settings.persona);
  const tasks = await getTasks();
  for (const t of tasks) {
    const extras = (t as any).reminderIds as string[] | undefined;
    await cancelMany([t.notificationId, ...(extras ?? [])]);
    const ids = await scheduleTaskReminders(t, settings.persona);
    (t as any).reminderIds = ids;
    t.notificationId = ids[0] ?? null;
  }
  await saveTasks(tasks);

  const plans = await getPlans();
  for (const p of plans) {
    await cancelMany(p.reminderIds);
    const ids = await schedulePlanReminders(p, settings.persona);
    p.reminderIds = ids;
  }
  await savePlans(plans);
}

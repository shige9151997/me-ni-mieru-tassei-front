import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import {
  addPlan,
  computeAchievementPct,
  dateKey,
  deletePlan,
  deleteSession,
  formatTime,
  getPlans,
  getSessions,
  getSettings,
  Plan,
  planMatchesDate,
  Session,
  Settings,
} from "@/src/storage";
import { cancelMany, schedulePlanReminders } from "@/src/notifications";

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];
// Map JS getDay() index (Sun=0..Sat=6) → display label.
const WEEKDAY_LABEL_BY_JS: Record<number, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};
// JS getDay() indexes rendered in Monday-first visual order.
const WEEKDAY_VIEW_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Return a 0-based day-of-week index with Monday=0 ... Sunday=6. */
function weekdayMonFirst(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startWeekday = weekdayMonFirst(first);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** First day (Monday) of the ISO-style week containing `d`. */
function weekStart(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - weekdayMonFirst(copy));
  return copy;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function weekKey(d: Date): string {
  const ws = weekStart(d);
  return dateKey(ws);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function planDisplayName(p: Plan): string {
  return p.name ?? p.text ?? "";
}

interface PeriodComment {
  overall_pct: number;
  tone: string;
  comment: string;
}

function PeriodBanner({
  label,
  data,
  loading,
  testID,
}: {
  label: string;
  data: PeriodComment | null;
  loading: boolean;
  testID: string;
}) {
  const { colors } = useTheme();
  const styles = useBannerStyles();
  if (!data && !loading) return null;
  const tone = data?.tone ?? "neutral";
  const color =
    tone === "praise"
      ? colors.success
      : tone === "scold"
        ? colors.warning
        : colors.brandPrimary;
  return (
    <View style={styles.banner} testID={testID}>
      <View style={[styles.bar, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerLabel}>{label}</Text>
        {loading ? (
          <Text style={styles.bannerBody}>生成中…</Text>
        ) : (
          <Text style={styles.bannerBody}>{data?.comment}</Text>
        )}
      </View>
    </View>
  );
}

const useBannerStyles = makeStyles((colors) => ({
  banner: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    alignSelf: "stretch",
  },
  bannerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: 4,
    letterSpacing: 1,
  },
  bannerBody: {
    fontSize: 14,
    color: colors.onSurfaceSecondary,
    lineHeight: 22,
  },
}));

function sessionPct(s: Session): number {
  const stored = (s as any).achievementPct;
  if (typeof stored === "number") return stored;
  return computeAchievementPct(s.targetSeconds, s.elapsedSeconds);
}

function pctDotColor(
  colors: { success: string; warning: string; error: string },
  pct: number,
): string {
  if (pct >= 100) return colors.success;
  if (pct >= 70) return colors.warning;
  return colors.error;
}

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { colors } = useTheme();
  const styles = useStyles();

  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<string>(dateKey(new Date()));

  const [planOpen, setPlanOpen] = useState(false);
  const [pName, setPName] = useState("");
  const [pTime, setPTime] = useState("09:00");
  const [pTargetHour, setPTargetHour] = useState("00");
  const [pTargetMinute, setPTargetMinute] = useState("30");
  const [pWeekdays, setPWeekdays] = useState<number[]>([]);

  const reload = useCallback(async () => {
    const [ss, ps, st] = await Promise.all([getSessions(), getPlans(), getSettings()]);
    setSessions(ss);
    setPlans(ps);
    setSettings(st);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const dailyPct = useMemo(() => {
    const map: Record<string, { total: number; sum: number }> = {};
    for (const s of sessions) {
      const pct = sessionPct(s);
      if (!map[s.date]) map[s.date] = { total: 0, sum: 0 };
      map[s.date].total += 1;
      map[s.date].sum += pct;
    }
    const out: Record<string, number> = {};
    for (const k of Object.keys(map)) {
      out[k] = Math.round(map[k].sum / map[k].total);
    }
    return out;
  }, [sessions]);

  const planDaySet = useMemo(() => {
    // For a quick "has plan today" lookup in the visible month cells.
    const set = new Set<string>();
    for (const p of plans) {
      if (p.date) set.add(p.date);
      if (Array.isArray(p.weekdays) && p.weekdays.length > 0) {
        // Mark all days in the visible month that match any weekday
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const dt = new Date(year, month, d);
          if (p.weekdays.includes(dt.getDay())) set.add(dateKey(dt));
        }
      }
    }
    return set;
  }, [plans, cursor]);

  const todayPct = dailyPct[dateKey(new Date())] ?? 0;

  const weekSessions = useMemo(() => {
    const ws = weekStart(new Date());
    const weStart = ws.getTime();
    const weEnd = ws.getTime() + 7 * 24 * 60 * 60 * 1000;
    return sessions.filter((s) => {
      const t = new Date(s.date).getTime();
      return t >= weStart && t < weEnd;
    });
  }, [sessions]);

  const monthSessions = useMemo(() => {
    const now = new Date();
    const ms = monthStart(now).getTime();
    const me = monthEnd(now).getTime() + 24 * 60 * 60 * 1000;
    return sessions.filter((s) => {
      const t = new Date(s.date).getTime();
      return t >= ms && t < me;
    });
  }, [sessions]);

  const weekPct = useMemo(() => {
    if (weekSessions.length === 0) return 0;
    return Math.round(
      weekSessions.reduce((sum, s) => sum + sessionPct(s), 0) / weekSessions.length,
    );
  }, [weekSessions]);

  const monthPct = useMemo(() => {
    if (monthSessions.length === 0) return 0;
    return Math.round(
      monthSessions.reduce((sum, s) => sum + sessionPct(s), 0) / monthSessions.length,
    );
  }, [monthSessions]);

  const [dayComment, setDayComment] = useState<PeriodComment | null>(null);
  const [weekComment, setWeekComment] = useState<PeriodComment | null>(null);
  const [monthComment, setMonthComment] = useState<PeriodComment | null>(null);
  const [loadingPeriod, setLoadingPeriod] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  // Include the persona signature so changing settings invalidates each cache
  // and the comments are regenerated with the newly chosen tone.
  const settingsSig = settings
    ? `${settings.persona}|${settings.firstPerson ?? ""}|${settings.ending ?? ""}`
    : "";
  const dayCacheKey = `${settingsSig}|${dateKey(new Date())}|${sessions.filter((s) => s.date === dateKey(new Date())).map((s) => s.id).join(",")}`;
  const weekCacheKey = `${settingsSig}|${weekKey(new Date())}|${weekSessions.map((s) => s.id).join(",")}`;
  const monthCacheKey = `${settingsSig}|${monthKey(new Date())}|${monthSessions.map((s) => s.id).join(",")}`;

  const fetchPeriod = useCallback(
    async (
      period: "day" | "week" | "month",
      label: string,
      items: Session[],
      setter: (c: PeriodComment | null) => void,
      s: Settings | null,
    ) => {
      const settingsToUse = s ?? (await getSettings());
      if (items.length === 0) {
        setter(null);
        return;
      }
      setLoadingPeriod(period);
      try {
        const res = await fetch(`${BACKEND_URL}/api/period-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            period,
            label,
            sessions: items.map((it) => ({
              name: it.taskName,
              target_seconds: it.targetSeconds,
              elapsed_seconds: it.elapsedSeconds,
              achievement_pct: sessionPct(it),
            })),
            persona: settingsToUse.persona,
            first_person: settingsToUse.firstPerson || null,
            ending: settingsToUse.ending || null,
          }),
        });
        const data = (await res.json()) as PeriodComment;
        setter(data);
      } catch {
        setter({ overall_pct: 0, tone: "neutral", comment: "コメントを取得できませんでした。" });
      } finally {
        setLoadingPeriod((p) => (p === period ? null : p));
      }
    },
    [],
  );

  const lastDayKeyRef = useRef<string>("");
  const lastWeekKeyRef = useRef<string>("");
  const lastMonthKeyRef = useRef<string>("");

  useEffect(() => {
    if (!settings || lastDayKeyRef.current === dayCacheKey) return;
    lastDayKeyRef.current = dayCacheKey;
    const today = dateKey(new Date());
    const todaysSessions = sessions.filter((s) => s.date === today);
    fetchPeriod("day", "今日", todaysSessions, setDayComment, settings);
  }, [dayCacheKey, fetchPeriod, sessions, settings]);

  useEffect(() => {
    if (!settings || lastWeekKeyRef.current === weekCacheKey) return;
    lastWeekKeyRef.current = weekCacheKey;
    fetchPeriod("week", "今週", weekSessions, setWeekComment, settings);
  }, [weekCacheKey, fetchPeriod, weekSessions, settings]);

  useEffect(() => {
    if (!settings || lastMonthKeyRef.current === monthCacheKey) return;
    lastMonthKeyRef.current = monthCacheKey;
    fetchPeriod("month", "今月", monthSessions, setMonthComment, settings);
  }, [monthCacheKey, fetchPeriod, monthSessions, settings]);

  const cells = monthMatrix(cursor.getFullYear(), cursor.getMonth());
  const monthLabel = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;

  const daySessions = sessions.filter((s) => s.date === selected);
  const selectedDate = useMemo(() => {
    const [y, m, d] = selected.split("-").map((v) => parseInt(v, 10));
    return new Date(y, (m || 1) - 1, d || 1);
  }, [selected]);
  const dayPlans = plans.filter((p) => planMatchesDate(p, selectedDate));
  const selectedDayPct = dailyPct[selected] ?? 0;

  const bg = (pct: number) => {
    if (pct <= 0) return colors.surfaceTertiary;
    const alpha = Math.max(0.15, Math.min(1, pct / 100));
    return `rgba(92,114,86,${alpha.toFixed(2)})`;
  };

  const textColor = (pct: number) =>
    pct >= 60 ? colors.onBrandPrimary : colors.onSurface;

  const onDeleteSession = async (id: string) => {
    await deleteSession(id);
    reload();
  };

  const onDeletePlan = async (p: Plan) => {
    await cancelMany(p.reminderIds);
    await deletePlan(p.id);
    reload();
  };

  const openAddPlan = () => {
    setPName("");
    setPTime("09:00");
    setPTargetHour("00");
    setPTargetMinute("30");
    setPWeekdays([]);
    setPlanOpen(true);
  };

  const toggleWeekday = (w: number) => {
    setPWeekdays((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort(),
    );
  };

  const savePlan = async () => {
    const name = pName.trim();
    if (!name) return;
    const th = Math.max(0, Math.min(23, parseInt(pTargetHour || "0", 10)));
    const tm = Math.max(0, Math.min(59, parseInt(pTargetMinute || "0", 10)));
    const target = Math.max(1, th * 60 + tm);
    const time = pTime.trim() || "09:00";
    const isRecurring = pWeekdays.length > 0;
    const base: Plan = {
      id: `${Date.now()}`,
      name,
      date: isRecurring ? null : selected,
      weekdays: isRecurring ? pWeekdays : [],
      time,
      targetMinutes: target,
      reminderIds: [],
      createdAt: Date.now(),
    };
    const settings = await getSettings();
    const ids = await schedulePlanReminders(base, settings.persona);
    base.reminderIds = ids;
    await addPlan(base);
    setPlanOpen(false);
    reload();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>カレンダー</Text>
          <Text style={styles.subtitle}>日毎の達成率と予定を可視化</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingBottom: bottomChrome + spacing.xl,
        }}
      >
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>今日</Text>
            <Text style={styles.statValue} testID="today-pct">
              {todayPct}%
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>今週</Text>
            <Text style={styles.statValue} testID="week-pct">
              {weekPct}%
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>今月</Text>
            <Text style={styles.statValue} testID="month-pct">
              {monthPct}%
            </Text>
          </View>
        </View>

        {(dayComment || weekComment || monthComment || loadingPeriod) && (
          <View style={styles.commentStack}>
            <PeriodBanner
              testID="comment-day"
              label="今日のコメント"
              data={dayComment}
              loading={loadingPeriod === "day"}
            />
            <PeriodBanner
              testID="comment-week"
              label="今週のコメント"
              data={weekComment}
              loading={loadingPeriod === "week"}
            />
            <PeriodBanner
              testID="comment-month"
              label="今月のコメント"
              data={monthComment}
              loading={loadingPeriod === "month"}
            />
          </View>
        )}

        <View style={styles.monthHeader}>
          <Pressable
            testID="prev-month"
            onPress={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
            style={styles.navBtn}
          >
            <Feather name="chevron-left" size={20} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.monthLabel} testID="month-label">
            {monthLabel}
          </Text>
          <Pressable
            testID="next-month"
            onPress={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
            style={styles.navBtn}
          >
            <Feather name="chevron-right" size={20} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAY_LABELS.map((w) => (
            <Text key={w} style={styles.weekLabel}>
              {w}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((d, i) => {
            if (!d) return <View key={`e-${i}`} style={styles.cellEmpty} />;
            const k = dateKey(d);
            const pct = dailyPct[k] ?? 0;
            const hasPlan = planDaySet.has(k);
            const isSelected = k === selected;
            return (
              <Pressable
                key={k}
                testID={`day-${k}`}
                onPress={() => setSelected(k)}
                style={[
                  styles.cell,
                  { backgroundColor: bg(pct) },
                  isSelected && styles.cellSelected,
                ]}
              >
                <Text style={[styles.cellDay, { color: textColor(pct) }]}>
                  {d.getDate()}
                </Text>
                {pct > 0 && (
                  <Text style={[styles.cellPct, { color: textColor(pct) }]}>
                    {pct}%
                  </Text>
                )}
                {hasPlan && (
                  <View
                    style={[
                      styles.planDot,
                      {
                        backgroundColor:
                          pct >= 60 ? colors.onBrandPrimary : colors.brandPrimary,
                      },
                    ]}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>{selected} の予定</Text>
          <Pressable testID="add-plan-btn" onPress={openAddPlan} style={styles.smallBtn}>
            <Feather name="plus" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.smallBtnText}>追加</Text>
          </Pressable>
        </View>
        {dayPlans.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>予定はまだありません</Text>
          </View>
        ) : (
          dayPlans.map((p) => (
            <View key={p.id} style={styles.planRow} testID={`plan-${p.id}`}>
              <Feather name="bookmark" size={16} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.planText}>{planDisplayName(p)}</Text>
                <Text style={styles.planTime}>
                  {p.time}
                  {p.targetMinutes
                    ? `  ·  目標 ${String(Math.floor(p.targetMinutes / 60)).padStart(2, "0")}:${String(p.targetMinutes % 60).padStart(2, "0")}`
                    : ""}
                  {p.weekdays && p.weekdays.length > 0
                    ? `  ·  繰り返し ${p.weekdays
                        .map((w) => WEEKDAY_LABEL_BY_JS[w])
                        .join("・")}`
                    : ""}
                </Text>
              </View>
              <Pressable
                testID={`delete-plan-${p.id}`}
                hitSlop={10}
                onPress={() => onDeletePlan(p)}
                style={styles.iconBtn}
              >
                <Feather name="trash-2" size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))
        )}

        <View style={[styles.sectionHeadRow, { marginTop: spacing.lg }]}>
          <Text style={styles.sectionTitle}>達成項目</Text>
          {daySessions.length > 0 && (
            <Text style={styles.sectionMeta} testID="day-avg-pct">
              平均 {selectedDayPct}%
            </Text>
          )}
        </View>
        {daySessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>この日の記録はありません</Text>
          </View>
        ) : (
          daySessions.map((s) => {
            const pct = sessionPct(s);
            const dotColor = pctDotColor(colors, pct);
            return (
              <View key={s.id} style={styles.sessionRow} testID={`session-${s.id}`}>
                <View style={[styles.dot, { backgroundColor: dotColor }]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.sessionHead}>
                    <Text style={styles.sessionName}>{s.taskName}</Text>
                    <Text style={[styles.sessionPct, { color: dotColor }]}>
                      {pct}%
                    </Text>
                  </View>
                  <Text style={styles.sessionMeta}>
                    経過 {formatTime(s.elapsedSeconds)} / 目標{" "}
                    {formatTime(s.targetSeconds)} ·{" "}
                    {s.diffSeconds >= 0 ? "+" : ""}
                    {Math.round(s.diffSeconds / 60)}分
                  </Text>
                  {!!s.comment && (
                    <Text style={styles.sessionComment} numberOfLines={3}>
                      {s.comment}
                    </Text>
                  )}
                </View>
                <Pressable
                  testID={`delete-session-${s.id}`}
                  hitSlop={10}
                  onPress={() => onDeleteSession(s.id)}
                  style={styles.iconBtn}
                >
                  <Feather name="trash-2" size={16} color={colors.muted} />
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={planOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPlanOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalBackdrop}
        >
          <ScrollView
            contentContainerStyle={{ justifyContent: "flex-end", flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sheet} testID="plan-form-sheet">
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>
                {pWeekdays.length > 0 ? "繰り返し予定" : `${selected} の予定`}
              </Text>

              <Text style={styles.label}>名前</Text>
              <TextInput
                testID="plan-name-input"
                value={pName}
                onChangeText={setPName}
                placeholder="例: 数学の過去問"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />

              <Text style={styles.label}>開始時刻（HH:mm）</Text>
              <TextInput
                testID="plan-time-input"
                value={pTime}
                onChangeText={setPTime}
                placeholder="09:00"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />

              <Text style={styles.label}>目標時間（HH:MM）</Text>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <TextInput
                  testID="plan-target-hour-input"
                  value={pTargetHour}
                  onChangeText={setPTargetHour}
                  keyboardType="number-pad"
                  maxLength={2}
                  style={[styles.input, { flex: 1 }]}
                />
                <Text style={{ fontSize: 20, alignSelf: "center", color: colors.onSurface }}>:</Text>
                <TextInput
                  testID="plan-target-minute-input"
                  value={pTargetMinute}
                  onChangeText={setPTargetMinute}
                  keyboardType="number-pad"
                  maxLength={2}
                  style={[styles.input, { flex: 1 }]}
                />
              </View>

              <Text style={styles.label}>曜日の繰り返し（未選択で単発）</Text>
              <View style={styles.weekdayRow}>
                {WEEKDAY_VIEW_ORDER.map((jsIdx) => {
                  const active = pWeekdays.includes(jsIdx);
                  return (
                    <Pressable
                      key={jsIdx}
                      testID={`weekday-${jsIdx}`}
                      onPress={() => toggleWeekday(jsIdx)}
                      style={[styles.wdChip, active && styles.wdChipActive]}
                    >
                      <Text
                        style={[
                          styles.wdChipText,
                          active && styles.wdChipTextActive,
                        ]}
                      >
                        {WEEKDAY_LABEL_BY_JS[jsIdx]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.btnRow}>
                <Pressable
                  testID="plan-cancel-btn"
                  onPress={() => setPlanOpen(false)}
                  style={[styles.actionBtn, styles.actionBtnGhost]}
                >
                  <Text style={styles.actionBtnGhostText}>キャンセル</Text>
                </Pressable>
                <Pressable
                  testID="plan-save-btn"
                  onPress={savePlan}
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                >
                  <Text style={styles.actionBtnPrimaryText}>保存</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  statRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: { fontSize: 12, color: colors.muted },
  statValue: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.onSurfaceSecondary,
    marginTop: 4,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  navBtn: { padding: spacing.sm },
  monthLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: colors.onSurface,
  },
  weekRow: { flexDirection: "row", marginBottom: spacing.xs },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    color: colors.muted,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: spacing.xl },
  commentStack: { marginBottom: spacing.md },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  cellEmpty: { width: `${100 / 7}%`, aspectRatio: 1 },
  cellSelected: { borderWidth: 2, borderColor: colors.onSurface },
  cellDay: { fontSize: 14, fontWeight: "600" },
  cellPct: { fontSize: 9, marginTop: 1 },
  planDot: {
    position: "absolute",
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  sectionHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: colors.onSurface },
  sectionMeta: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandPrimary,
    fontVariant: ["tabular-nums"],
  },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  smallBtnText: {
    color: colors.onBrandPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.muted },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  planText: {
    fontSize: 15,
    color: colors.onSurfaceSecondary,
    fontWeight: "500",
  },
  planTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  iconBtn: { padding: spacing.sm },
  sessionRow: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    alignItems: "flex-start",
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  sessionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sessionName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.onSurfaceSecondary,
    flex: 1,
    paddingRight: spacing.sm,
  },
  sessionPct: {
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  sessionMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  sessionComment: {
    fontSize: 13,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.onSurfaceSecondary,
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.onSurface,
  },
  weekdayRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  wdChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  wdChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  wdChipText: { fontSize: 14, color: colors.onSurface, fontWeight: "600" },
  wdChipTextActive: { color: colors.onBrandPrimary },
  btnRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  actionBtn: {
    flex: 1,
    height: 50,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnGhost: { backgroundColor: colors.surfaceTertiary },
  actionBtnPrimary: { backgroundColor: colors.brandPrimary },
  actionBtnGhostText: {
    color: colors.onSurfaceTertiary,
    fontWeight: "600",
    fontSize: 16,
  },
  actionBtnPrimaryText: {
    color: colors.onBrandPrimary,
    fontWeight: "600",
    fontSize: 16,
  },
}));

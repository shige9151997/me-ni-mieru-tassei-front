import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";
import {
  Category,
  categoryLabel,
  dateKey,
  formatTime,
  getPlans,
  getRuns,
  getSessions,
  getSettings,
  getLastSummaryDate,
  Plan,
  planMatchesDate,
  personaLabel,
  recordCompletion,
  RunState,
  saveRuns,
  Session,
  setLastSummaryDate,
  Settings,
  Task,
  getTasks,
} from "@/src/storage";
import {
  dismissLiveActivity,
  ensureDailySummaryNotification,
  ensureMonthlySummaryNotification,
  ensureWeeklySummaryNotification,
  presentLiveActivity,
} from "@/src/notifications";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Status = "idle" | "running" | "paused";

type TaskRun = RunState;

interface MeasurableItem {
  id: string;
  name: string;
  category: Category;
  targetSeconds: number;
  source: "task" | "plan";
}

function taskToItem(t: Task): MeasurableItem {
  return {
    id: `task-${t.id}`,
    name: t.name,
    category: t.category,
    targetSeconds: t.targetSeconds,
    source: "task",
  };
}

function planToItem(p: Plan): MeasurableItem {
  return {
    id: `plan-${p.id}`,
    name: p.name ?? (p as any).text ?? "予定",
    category: "custom",
    targetSeconds: Math.max(1, p.targetMinutes || 1) * 60,
    source: "plan",
  };
}

/** Analog clock face that displays `elapsed` seconds. */
function AnalogClock({
  elapsed,
  targetSeconds,
  size,
  colors,
}: {
  elapsed: number;
  targetSeconds: number;
  size: number;
  colors: {
    brandPrimary: string;
    onSurface: string;
    muted: string;
    surfaceTertiary: string;
    success: string;
    borderStrong: string;
  };
}) {
  const seconds = elapsed % 60;
  const minutes = Math.floor(elapsed / 60) % 60;
  const hours = Math.floor(elapsed / 3600);

  const secDeg = seconds * 6;
  const minDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = (hours % 12) * 30 + minutes * 0.5;

  const over = elapsed > targetSeconds;
  const hourColor = over ? colors.success : colors.onSurface;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: colors.borderStrong,
        backgroundColor: colors.surfaceTertiary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * 2 * Math.PI;
        const r = size / 2 - 10;
        const x = Math.sin(angle) * r;
        const y = -Math.cos(angle) * r;
        const major = i % 3 === 0;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              width: major ? 3 : 2,
              height: major ? 10 : 6,
              borderRadius: 1,
              backgroundColor: major ? colors.onSurface : colors.muted,
              transform: [
                { translateX: x },
                { translateY: y },
                { rotate: `${(i / 12) * 360}deg` },
              ],
            }}
          />
        );
      })}
      {/* Hands: wrapper is full-size; the bar sits top-center and rotates about center */}
      <ClockHand size={size} deg={hourDeg} length={size * 0.28} width={5} color={hourColor} />
      <ClockHand size={size} deg={minDeg} length={size * 0.38} width={4} color={colors.onSurface} />
      <ClockHand size={size} deg={secDeg} length={size * 0.42} width={2} color={colors.brandPrimary} />
      <View
        style={{
          position: "absolute",
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: colors.brandPrimary,
        }}
      />
    </View>
  );
}

function ClockHand({
  size,
  deg,
  length,
  width,
  color,
}: {
  size: number;
  deg: number;
  length: number;
  width: number;
  color: string;
}) {
  return (
    <View
      style={{
        position: "absolute",
        width: size,
        height: size,
        alignItems: "center",
        transform: [{ rotate: `${deg}deg` }],
      }}
      pointerEvents="none"
    >
      <View
        style={{
          width,
          height: length,
          marginTop: size / 2 - length,
          backgroundColor: color,
          borderRadius: width / 2,
        }}
      />
    </View>
  );
}

export default function TimerScreen() {
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { colors } = useTheme();
  const styles = useStyles();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, TaskRun>>({});
  const [runsHydrated, setRunsHydrated] = useState<boolean>(false);
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const [analog, setAnalog] = useState<boolean>(false);

  const [showResult, setShowResult] = useState(false);
  const [loadingComment, setLoadingComment] = useState(false);
  const [result, setResult] = useState<{
    comment: string;
    diff: number;
    status: string;
    elapsed: number;
    target: number;
    taskName: string;
  } | null>(null);

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<{
    overall_pct: number;
    comment: string;
    tone: string;
  } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    const [t, p, s] = await Promise.all([getTasks(), getPlans(), getSettings()]);
    setTasks(t);
    setPlans(p);
    setSettings(s);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Hydrate runs from storage exactly once; persisting is gated on this flag so
  // the initial empty state cannot overwrite stored timestamps on first mount.
  useEffect(() => {
    (async () => {
      const r = await getRuns();
      setRuns(r);
      setRunsHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (runsHydrated) saveRuns(runs);
  }, [runs, runsHydrated]);

  // Daily reminder notification: pick up the current persona.
  useEffect(() => {
    if (!settings) return;
    ensureDailySummaryNotification(settings.persona);
    ensureWeeklySummaryNotification(settings.persona);
    ensureMonthlySummaryNotification(settings.persona);
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    (async () => {
      const now = new Date();
      const afterCutoff =
        now.getHours() > 23 || (now.getHours() === 23 && now.getMinutes() >= 50);
      if (!afterCutoff) return;
      const today = dateKey(now);
      const last = await getLastSummaryDate();
      if (last === today) return;
      const sessions = await getSessions();
      const todays = sessions.filter((s) => s.date === today);
      if (todays.length === 0) return;
      setSummaryOpen(true);
      setSummaryLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/daily-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: today,
            sessions: todays.map((s) => ({
              name: s.taskName,
              target_seconds: s.targetSeconds,
              elapsed_seconds: s.elapsedSeconds,
              achievement_pct:
                (s as any).achievementPct ??
                (s.targetSeconds > 0
                  ? Math.round((s.elapsedSeconds / s.targetSeconds) * 100)
                  : 0),
            })),
            persona: settings.persona,
            first_person: settings.firstPerson || null,
            ending: settings.ending || null,
          }),
        });
        const data = await res.json();
        setSummary(data);
        await setLastSummaryDate(today);
      } catch {
        setSummary({
          overall_pct: 0,
          tone: "scold",
          comment: "今日の記録を取得できなかったわ。明日こそ、ね。",
        });
      } finally {
        setSummaryLoading(false);
      }
    })();
  }, [settings]);

  const items = useMemo<MeasurableItem[]>(() => {
    const today = new Date();
    const taskItems = tasks.map(taskToItem);
    const planItems = plans
      .filter((p) => planMatchesDate(p, today))
      .map(planToItem);
    return [...taskItems, ...planItems];
  }, [tasks, plans]);

  // Keep active selection valid as items change
  useEffect(() => {
    setActiveId((prev) => {
      if (prev && items.find((x) => x.id === prev)) return prev;
      return items[0]?.id ?? null;
    });
  }, [items]);

  // Shared interval runs only when something is counting
  useEffect(() => {
    const anyRunning = Object.values(runs).some((r) => r.status === "running");
    if (anyRunning && !intervalRef.current) {
      intervalRef.current = setInterval(() => setNowTs(Date.now()), 250);
    } else if (!anyRunning && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [runs]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const elapsedOf = (id: string | null): number => {
    if (!id) return 0;
    const r = runs[id];
    if (!r) return 0;
    const seg = r.segmentStart != null ? (nowTs - r.segmentStart) / 1000 : 0;
    return Math.floor(r.baseElapsed + seg);
  };

  const statusOf = (id: string | null): Status => {
    if (!id) return "idle";
    return runs[id]?.status ?? "idle";
  };

  const anyRunning = Object.values(runs).some((r) => r.status === "running");

  const start = (id: string) => {
    if (anyRunning) return;
    const now = Date.now();
    setRuns((prev) => ({
      ...prev,
      [id]: {
        status: "running",
        baseElapsed: 0,
        segmentStart: now,
        sessionStart: now,
      },
    }));
    const item = items.find((x) => x.id === id);
    if (item) presentLiveActivity(item.name, now, item.targetSeconds);
  };

  const pause = (id: string) => {
    setRuns((prev) => {
      const r = prev[id];
      if (!r || r.status !== "running") return prev;
      const addSec =
        r.segmentStart != null ? (Date.now() - r.segmentStart) / 1000 : 0;
      return {
        ...prev,
        [id]: {
          ...r,
          status: "paused",
          baseElapsed: r.baseElapsed + addSec,
          segmentStart: null,
        },
      };
    });
    dismissLiveActivity();
  };

  const resume = (id: string) => {
    if (anyRunning) return;
    setRuns((prev) => {
      const r = prev[id];
      if (!r || r.status !== "paused") return prev;
      return {
        ...prev,
        [id]: { ...r, status: "running", segmentStart: Date.now() },
      };
    });
    const item = items.find((x) => x.id === id);
    const r = runs[id];
    if (item && r) {
      presentLiveActivity(item.name, Date.now(), item.targetSeconds);
    }
  };

  const stop = async (id: string) => {
    const item = items.find((x) => x.id === id);
    const r = runs[id];
    if (!item || !r || r.status === "idle") return;

    const addSec =
      r.segmentStart != null ? (Date.now() - r.segmentStart) / 1000 : 0;
    const finalElapsed = Math.floor(r.baseElapsed + addSec);

    setRuns((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    dismissLiveActivity();

    setShowResult(true);
    setLoadingComment(true);

    let comment = "";
    let status = "ontime";
    try {
      const res = await fetch(`${BACKEND_URL}/api/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_name: item.name,
          category: categoryLabel[item.category],
          target_seconds: item.targetSeconds,
          elapsed_seconds: finalElapsed,
          persona: settings?.persona ?? "sister",
          first_person: settings?.firstPerson || null,
          ending: settings?.ending || null,
        }),
      });
      const data = await res.json();
      comment = data.comment;
      status = data.status;
    } catch {
      comment = "お疲れさま。あなたの頑張り、ちゃんと見てたわよ。";
    }

    const saved = await recordCompletion({
      taskId: item.id,
      taskName: item.name,
      category: item.category,
      targetSeconds: item.targetSeconds,
      elapsedSeconds: finalElapsed,
      comment,
      startedAt: r.sessionStart,
      completedAt: Date.now(),
    });

    setResult({
      comment,
      diff: saved.diffSeconds,
      status,
      elapsed: saved.elapsedSeconds,
      target: saved.targetSeconds,
      taskName: saved.taskName,
    });
    setLoadingComment(false);
  };

  const active = items.find((x) => x.id === activeId) ?? null;
  const activeStatus = statusOf(activeId);
  const activeElapsed = elapsedOf(activeId);
  const activeOver = active ? activeElapsed > active.targetSeconds : false;
  const activeProgress =
    active && active.targetSeconds > 0
      ? Math.min(1, activeElapsed / active.targetSeconds)
      : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>目に見える達成</Text>
          <Text style={styles.subtitle}>開始から完了までカウントアップ</Text>
        </View>
        <Pressable
          testID="toggle-display-btn"
          onPress={() => setAnalog((v) => !v)}
          style={styles.toggleBtn}
        >
          <Feather
            name={analog ? "watch" : "clock"}
            size={16}
            color={colors.onSurface}
          />
          <Text style={styles.toggleText}>
            {analog ? "デジタル" : "アナログ"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        {items.length === 0 ? (
          <View style={styles.emptyChip}>
            <Text style={styles.emptyChipText} testID="no-tasks-chip">
              「項目」または「カレンダー」で予定を追加してください
            </Text>
          </View>
        ) : (
          items.map((t) => {
            const activeChip = activeId === t.id;
            const st = statusOf(t.id);
            const isPlan = t.source === "plan";
            return (
              <Pressable
                key={t.id}
                testID={`task-chip-${t.id}`}
                onPress={() => setActiveId(t.id)}
                style={[
                  styles.chip,
                  isPlan && !activeChip && styles.chipPlan,
                  activeChip && styles.chipActive,
                ]}
              >
                {isPlan && (
                  <Feather
                    name="bookmark"
                    size={12}
                    color={activeChip ? colors.onBrandPrimary : colors.brandPrimary}
                  />
                )}
                <Text style={[styles.chipText, activeChip && styles.chipTextActive]}>
                  {t.name}
                </Text>
                {st === "running" && (
                  <View
                    style={[styles.chipDot, { backgroundColor: colors.success }]}
                  />
                )}
                {st === "paused" && (
                  <View
                    style={[styles.chipDot, { backgroundColor: colors.warning }]}
                  />
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={styles.timerArea}>
        {active ? (
          <>
            <Text style={styles.categoryLabel}>
              {categoryLabel[active.category]}
              {active.source === "plan" ? "  ·  予定" : ""}
            </Text>
            {analog ? (
              <View style={{ alignItems: "center" }}>
                <AnalogClock
                  elapsed={activeElapsed}
                  targetSeconds={active.targetSeconds}
                  size={240}
                  colors={colors}
                />
                <Text
                  style={styles.analogDigital}
                  testID="elapsed-text"
                >
                  {formatTime(activeElapsed)}
                </Text>
              </View>
            ) : (
              <Text style={styles.timerText} testID="elapsed-text">
                {formatTime(activeElapsed)}
              </Text>
            )}
            {activeStatus === "paused" && (
              <Text style={styles.pausedTag} testID="paused-indicator">
                一時停止中
              </Text>
            )}
            {!analog && (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, activeProgress * 100)}%`,
                      backgroundColor: activeOver ? colors.success : colors.brandPrimary,
                    },
                  ]}
                />
              </View>
            )}
            <Text style={[styles.targetText, activeOver && { color: colors.success }]}>
              目標 {formatTime(active.targetSeconds)}
              {activeOver ? "  （達成）" : ""}
            </Text>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Feather name="clock" size={40} color={colors.muted} />
            <Text style={styles.emptyText}>項目または予定を追加してください</Text>
          </View>
        )}
      </View>

      <View style={[styles.ctaWrap, { paddingBottom: bottomChrome + spacing.lg }]}>
        {activeStatus === "idle" && (
          <Pressable
            testID="start-btn"
            disabled={!active || anyRunning}
            onPress={() => active && start(active.id)}
            style={[styles.cta, (!active || anyRunning) && { opacity: 0.4 }]}
          >
            <Feather name="play" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.ctaText}>
              {anyRunning ? "他の項目を一時停止してください" : "開始"}
            </Text>
          </Pressable>
        )}
        {activeStatus === "running" && active && (
          <View style={styles.ctaRow}>
            <Pressable
              testID="pause-btn"
              onPress={() => pause(active.id)}
              style={[styles.cta, styles.ctaPause]}
            >
              <Feather name="pause" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>一時停止</Text>
            </Pressable>
            <Pressable
              testID="stop-btn"
              onPress={() => stop(active.id)}
              style={[styles.cta, styles.ctaStop]}
            >
              <Feather name="square" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>完了</Text>
            </Pressable>
          </View>
        )}
        {activeStatus === "paused" && active && (
          <View style={styles.ctaRow}>
            <Pressable
              testID="resume-btn"
              onPress={() => resume(active.id)}
              disabled={anyRunning}
              style={[styles.cta, styles.ctaResume, anyRunning && { opacity: 0.4 }]}
            >
              <Feather name="play" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>再開</Text>
            </Pressable>
            <Pressable
              testID="stop-btn"
              onPress={() => stop(active.id)}
              style={[styles.cta, styles.ctaStop]}
            >
              <Feather name="square" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>完了</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Modal
        visible={showResult}
        transparent
        animationType="slide"
        onRequestClose={() => setShowResult(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="result-sheet">
            <View style={styles.sheetHandle} />
            {loadingComment ? (
              <View style={{ alignItems: "center", padding: spacing.xl }}>
                <ActivityIndicator color={colors.brandPrimary} />
                <Text style={styles.sheetMuted} testID="result-loading-text">
                  {personaLabel[settings?.persona ?? "sister"]}
                  がコメントを生成中…
                </Text>
              </View>
            ) : (
              result && (
                <>
                  <Text style={styles.sheetTitle}>{result.taskName}</Text>
                  <View style={styles.sheetRow}>
                    <View style={styles.sheetCell}>
                      <Text style={styles.sheetLabel}>達成時間</Text>
                      <Text style={styles.sheetValue}>{formatTime(result.elapsed)}</Text>
                    </View>
                    <View style={styles.sheetCell}>
                      <Text style={styles.sheetLabel}>目標</Text>
                      <Text style={styles.sheetValue}>{formatTime(result.target)}</Text>
                    </View>
                    <View style={styles.sheetCell}>
                      <Text style={styles.sheetLabel}>達成率</Text>
                      <Text
                        style={[
                          styles.sheetValue,
                          {
                            color:
                              result.status === "long"
                                ? colors.success
                                : result.status === "short"
                                  ? colors.warning
                                  : colors.onSurface,
                          },
                        ]}
                      >
                        {result.target > 0
                          ? Math.round((result.elapsed / result.target) * 100)
                          : 0}
                        %
                      </Text>
                    </View>
                  </View>
                  <View style={styles.commentBox}>
                    <Text style={styles.commentText} testID="ai-comment">
                      {result.comment}
                    </Text>
                  </View>
                  <Pressable
                    testID="close-sheet-btn"
                    onPress={() => setShowResult(false)}
                    style={styles.sheetClose}
                  >
                    <Text style={styles.sheetCloseText}>閉じる</Text>
                  </Pressable>
                </>
              )
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={summaryOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSummaryOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="summary-sheet">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>今日のふりかえり</Text>
            {summaryLoading ? (
              <View style={{ alignItems: "center", padding: spacing.xl }}>
                <ActivityIndicator color={colors.brandPrimary} />
                <Text style={styles.sheetMuted} testID="summary-loading-text">
                  {personaLabel[settings?.persona ?? "sister"]}
                  がコメントを生成中…
                </Text>
              </View>
            ) : (
              summary && (
                <>
                  <View style={styles.sheetRow}>
                    <View style={styles.sheetCell}>
                      <Text style={styles.sheetLabel}>達成率</Text>
                      <Text
                        testID="summary-pct"
                        style={[
                          styles.sheetValue,
                          {
                            color:
                              summary.tone === "praise"
                                ? colors.success
                                : summary.tone === "scold"
                                  ? colors.warning
                                  : colors.onSurface,
                          },
                        ]}
                      >
                        {summary.overall_pct}%
                      </Text>
                    </View>
                  </View>
                  <View style={styles.commentBox}>
                    <Text style={styles.commentText} testID="summary-comment">
                      {summary.comment}
                    </Text>
                  </View>
                  <Pressable
                    testID="close-summary-btn"
                    onPress={() => setSummaryOpen(false)}
                    style={styles.sheetClose}
                  >
                    <Text style={styles.sheetCloseText}>閉じる</Text>
                  </Pressable>
                </>
              )
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    marginTop: 4,
  },
  toggleText: { fontSize: 12, color: colors.onSurface, fontWeight: "600" },
  chipRow: { maxHeight: 56, flexGrow: 0 },
  chipRowContent: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    alignItems: "center",
    height: 56,
  },
  chip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipPlan: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brandTertiary,
  },
  chipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  chipText: { fontSize: 14, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary, fontWeight: "600" },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  emptyChip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    justifyContent: "center",
  },
  emptyChipText: { fontSize: 13, color: colors.muted },
  timerArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  categoryLabel: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.md,
    letterSpacing: 1,
  },
  timerText: {
    fontSize: 72,
    fontWeight: "300",
    color: colors.onSurface,
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  analogDigital: {
    marginTop: spacing.md,
    fontSize: 20,
    fontWeight: "500",
    color: colors.onSurface,
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },
  progressTrack: {
    width: "80%",
    height: 4,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 2,
    marginTop: spacing.xl,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2 },
  targetText: { fontSize: 14, color: colors.muted, marginTop: spacing.md },
  pausedTag: {
    marginTop: spacing.sm,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.warning,
    fontWeight: "600",
  },
  emptyState: { alignItems: "center", gap: spacing.md },
  emptyText: { color: colors.muted, fontSize: 15 },
  ctaWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  cta: {
    flex: 1,
    height: 56,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  ctaRow: { flexDirection: "row", gap: spacing.md },
  ctaPause: { backgroundColor: colors.brandSecondary },
  ctaResume: { backgroundColor: colors.brandPrimary },
  ctaStop: { backgroundColor: colors.onSurface },
  ctaText: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "600" },
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
  sheetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  sheetCell: { flex: 1, alignItems: "center" },
  sheetLabel: { fontSize: 12, color: colors.muted, marginBottom: 4 },
  sheetValue: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.onSurfaceSecondary,
    fontVariant: ["tabular-nums"],
  },
  commentBox: {
    backgroundColor: colors.brandTertiary,
    padding: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  commentText: { fontSize: 15, lineHeight: 24, color: colors.onBrandTertiary },
  sheetMuted: { color: colors.muted, marginTop: spacing.md, fontSize: 14 },
  sheetClose: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCloseText: { fontSize: 16, color: colors.onSurfaceTertiary, fontWeight: "600" },
}));

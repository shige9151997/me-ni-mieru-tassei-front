import { useCallback, useState } from "react";
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
  Category,
  categoryLabel,
  deleteTask,
  getSettings,
  getTasks,
  Task,
  upsertTask,
} from "@/src/storage";
import {
  cancelMany,
  scheduleTaskReminders,
} from "@/src/notifications";

const CATS: Category[] = ["study", "work", "custom"];

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { colors } = useTheme();
  const styles = useStyles();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [name, setName] = useState("");
  const [cat, setCat] = useState<Category>("study");
  const [targetHour, setTargetHour] = useState("00");
  const [targetMinute, setTargetMinute] = useState("30");
  const [hour, setHour] = useState("8");
  const [minute, setMinute] = useState("00");

  const reload = useCallback(async () => {
    setTasks(await getTasks());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const openCreate = () => {
    setEditing(null);
    setName("");
    setCat("study");
    setTargetHour("00");
    setTargetMinute("30");
    setHour("8");
    setMinute("00");
    setEditOpen(true);
  };

  const openEdit = (t: Task) => {
    setEditing(t);
    setName(t.name);
    setCat(t.category);
    const total = Math.max(1, Math.round(t.targetSeconds / 60));
    setTargetHour(String(Math.floor(total / 60)).padStart(2, "0"));
    setTargetMinute(String(total % 60).padStart(2, "0"));
    setHour(String(t.startHour));
    setMinute(String(t.startMinute).padStart(2, "0"));
    setEditOpen(true);
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const th = Math.max(0, Math.min(23, parseInt(targetHour || "0", 10)));
    const tm = Math.max(0, Math.min(59, parseInt(targetMinute || "0", 10)));
    const totalMin = Math.max(1, th * 60 + tm);
    const target = totalMin * 60;
    const h = Math.max(0, Math.min(23, parseInt(hour || "0", 10)));
    const m = Math.max(0, Math.min(59, parseInt(minute || "0", 10)));

    if (editing?.notificationId) await cancelMany([editing.notificationId]);
    if ((editing as any)?.reminderIds) await cancelMany((editing as any).reminderIds);

    const base: Task = {
      id: editing?.id ?? `${Date.now()}`,
      name: trimmedName,
      category: cat,
      targetSeconds: target,
      startHour: h,
      startMinute: m,
      createdAt: editing?.createdAt ?? Date.now(),
      notificationId: null,
    };

    const settings = await getSettings();
    const reminderIds = await scheduleTaskReminders(base, settings.persona);
    (base as any).reminderIds = reminderIds;
    base.notificationId = reminderIds[0] ?? null;

    await upsertTask(base);
    setEditOpen(false);
    reload();
  };

  const remove = async (t: Task) => {
    await cancelMany([t.notificationId, ...(((t as any).reminderIds as string[]) || [])].filter(Boolean) as string[]);
    await deleteTask(t.id);
    reload();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>項目</Text>
          <Text style={styles.subtitle}>目標時間と開始時刻を設定</Text>
        </View>
        <Pressable testID="create-task-btn" onPress={openCreate} style={styles.addBtn}>
          <Feather name="plus" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingBottom: bottomChrome + spacing.xl,
          gap: spacing.md,
        }}
      >
        {tasks.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="list" size={40} color={colors.muted} />
            <Text style={styles.emptyText}>項目を追加してみましょう</Text>
          </View>
        ) : (
          tasks.map((t) => (
            <Pressable
              key={t.id}
              testID={`task-row-${t.id}`}
              onPress={() => openEdit(t)}
              style={styles.row}
            >
              <View style={styles.catBadge}>
                <Text style={styles.catBadgeText}>{categoryLabel[t.category]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{t.name}</Text>
                <Text style={styles.rowMeta}>
                  目標 {Math.round(t.targetSeconds / 60)}分 · 開始{" "}
                  {String(t.startHour).padStart(2, "0")}:
                  {String(t.startMinute).padStart(2, "0")}
                </Text>
              </View>
              <Pressable
                testID={`delete-task-${t.id}`}
                hitSlop={10}
                onPress={() => remove(t)}
                style={styles.deleteBtn}
              >
                <Feather name="trash-2" size={18} color={colors.muted} />
              </Pressable>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal
        visible={editOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalBackdrop}
        >
          <View style={styles.sheet} testID="task-form-sheet">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {editing ? "項目を編集" : "新しい項目"}
            </Text>

            <Text style={styles.label}>名前</Text>
            <TextInput
              testID="name-input"
              value={name}
              onChangeText={setName}
              placeholder="例: 英語リスニング"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />

            <Text style={styles.label}>カテゴリ</Text>
            <View style={styles.catRow}>
              {CATS.map((c) => {
                const active = cat === c;
                return (
                  <Pressable
                    testID={`cat-${c}`}
                    key={c}
                    onPress={() => setCat(c)}
                    style={[styles.catChip, active && styles.catChipActive]}
                  >
                    <Text
                      style={[
                        styles.catChipText,
                        active && styles.catChipTextActive,
                      ]}
                    >
                      {categoryLabel[c]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>目標時間（HH:MM）</Text>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <TextInput
                testID="target-hour-input"
                value={targetHour}
                onChangeText={setTargetHour}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.input, { flex: 1 }]}
              />
              <Text style={styles.colon}>:</Text>
              <TextInput
                testID="target-minute-input"
                value={targetMinute}
                onChangeText={setTargetMinute}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.input, { flex: 1 }]}
              />
            </View>

            <Text style={styles.label}>開始時刻</Text>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <TextInput
                testID="hour-input"
                value={hour}
                onChangeText={setHour}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.input, { flex: 1 }]}
              />
              <Text style={styles.colon}>:</Text>
              <TextInput
                testID="minute-input"
                value={minute}
                onChangeText={setMinute}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.input, { flex: 1 }]}
              />
            </View>

            <View style={styles.btnRow}>
              <Pressable
                testID="cancel-btn"
                onPress={() => setEditOpen(false)}
                style={[styles.actionBtn, styles.actionBtnGhost]}
              >
                <Text style={styles.actionBtnGhostText}>キャンセル</Text>
              </Pressable>
              <Pressable
                testID="save-btn"
                onPress={save}
                style={[styles.actionBtn, styles.actionBtnPrimary]}
              >
                <Text style={styles.actionBtnPrimaryText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    marginTop: spacing.xxxl,
    alignItems: "center",
    gap: spacing.md,
  },
  emptyText: { color: colors.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.sm,
  },
  catBadgeText: { fontSize: 11, color: colors.onBrandTertiary, fontWeight: "600" },
  rowName: { fontSize: 16, color: colors.onSurfaceSecondary, fontWeight: "600" },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  deleteBtn: { padding: spacing.sm },
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
  colon: { fontSize: 20, alignSelf: "center", color: colors.onSurface },
  catRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  catChip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  catChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  catChipText: { fontSize: 14, color: colors.onSurface },
  catChipTextActive: { color: colors.onBrandPrimary, fontWeight: "600" },
  btnRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xl,
  },
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

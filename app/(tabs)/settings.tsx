import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import {
  defaultSettings,
  getSettings,
  Persona,
  personaLabel,
  saveSettings,
  Settings,
} from "@/src/storage";
import { rescheduleAllReminders } from "@/src/notifications";

const PERSONAS: Persona[] = [
  "loli",
  "mesugaki",
  "sister",
  "brother",
  "ai",
  "oba",
];

const PERSONA_DESCRIPTION: Record<Persona, string> = {
  loli: "幼く無邪気で甘える口調",
  mesugaki: "生意気で煽るような小悪魔的なメスガキ口調",
  sister: "艶っぽく上品な口調",
  brother: "頼れる兄貴分口調",
  ai: "冷静かつ事務的な口調",
  oba: "気さくで世話焼きなおばちゃん口調",
};

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { colors } = useTheme();
  const styles = useStyles();

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  };

  const onSave = async () => {
    await saveSettings(settings);
    await rescheduleAllReminders();
    setSaved(true);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>設定</Text>
        <Text style={styles.subtitle}>AIの口調と語り方をカスタマイズ</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.xl,
            paddingBottom: bottomChrome + spacing.xxl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>AIの口調</Text>
          <View style={{ gap: spacing.sm }}>
            {PERSONAS.map((p) => {
              const active = settings.persona === p;
              return (
                <Pressable
                  key={p}
                  testID={`persona-${p}`}
                  onPress={() => update({ persona: p })}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.optionTitle,
                        active && styles.optionTitleActive,
                      ]}
                    >
                      {personaLabel[p]}
                    </Text>
                    <Text
                      style={[
                        styles.optionDesc,
                        active && styles.optionDescActive,
                      ]}
                    >
                      {PERSONA_DESCRIPTION[p]}
                    </Text>
                  </View>
                  {active && (
                    <Feather name="check" size={20} color={colors.onBrandPrimary} />
                  )}
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>
            一人称（任意）
          </Text>
          <TextInput
            testID="first-person-input"
            value={settings.firstPerson ?? ""}
            onChangeText={(v) => update({ firstPerson: v })}
            placeholder="例: わたし / オレ / ボク / あたし"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />

          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
            語尾（任意）
          </Text>
          <TextInput
            testID="ending-input"
            value={settings.ending ?? ""}
            onChangeText={(v) => update({ ending: v })}
            placeholder="例: だよ / ですわ / じゃん / っす"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />

          <Pressable testID="save-settings-btn" onPress={onSave} style={styles.saveBtn}>
            <Feather name="save" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.saveBtnText}>{saved ? "保存しました" : "保存"}</Text>
          </Pressable>

          <Text style={styles.footer}>
            一人称と語尾を空欄にすると、キャラクター標準の口調で話します。
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  sectionLabel: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.sm,
    fontWeight: "600",
    letterSpacing: 1,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.onSurfaceSecondary,
  },
  optionTitleActive: { color: colors.onBrandPrimary },
  optionDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  optionDescActive: { color: colors.onBrandPrimary, opacity: 0.85 },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.onSurface,
  },
  saveBtn: {
    marginTop: spacing.xl,
    height: 54,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPrimary,
  },
  saveBtnText: {
    color: colors.onBrandPrimary,
    fontWeight: "600",
    fontSize: 16,
  },
  footer: {
    marginTop: spacing.lg,
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 18,
  },
}));

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FBFBF9",
  onSurface: "#1A1A18",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1A1A18",
  surfaceTertiary: "#F2F2ED",
  onSurfaceTertiary: "#3E3E3B",
  surfaceInverse: "#1F241E",
  onSurfaceInverse: "#FFFFFF",
  muted: "#878782",

  brand: "#5C7256",
  onBrand: "#FFFFFF",
  brandPrimary: "#5C7256",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#8C9C87",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E4EAE2",
  onBrandTertiary: "#2E3F29",

  success: "#4A6E46",
  onSuccess: "#FFFFFF",
  warning: "#B88E35",
  onWarning: "#FFFFFF",
  error: "#B04D44",
  onError: "#FFFFFF",
  info: "#606D69",
  onInfo: "#FFFFFF",

  border: "#E8E8E3",
  borderStrong: "#D0D0C8",
  divider: "#E8E8E3",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

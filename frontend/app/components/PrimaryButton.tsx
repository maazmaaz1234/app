import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { theme } from "../constants/theme";

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  testID?: string;
  variant?: "primary" | "secondary" | "danger";
}

export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  icon,
  testID,
  variant = "primary",
}: PrimaryButtonProps) {
  const scale = useSharedValue(1);
  const generatedTestId = testID || `btn-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const isDisabled = disabled || loading;
  const backgroundColor =
    variant === "secondary" ? theme.secondary : variant === "danger" ? theme.danger : theme.primary;

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        testID={generatedTestId}
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 16, stiffness: 220 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 220 });
        }}
        style={[styles.button, { backgroundColor }, isDisabled && styles.disabled]}
      >
        <View style={styles.content}>
          {icon ? <MaterialCommunityIcons name={icon} size={18} color={theme.text} /> : null}
          <Text style={styles.title}>{loading ? "Please wait..." : title}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.6,
  },
});

export default function PrimaryButtonRoute() {
  return null;
}

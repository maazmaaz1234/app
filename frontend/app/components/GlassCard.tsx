import React, { ReactNode } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { theme } from "../constants/theme";

interface GlassCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}

export function GlassCard({ children, style, delay = 0 }: GlassCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify()} style={[styles.card, style]}>
      <View>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.cardGlass,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    padding: 16,
  },
});

export default function GlassCardRoute() {
  return null;
}

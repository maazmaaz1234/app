import React from "react";
import { StyleSheet, View } from "react-native";

import { theme } from "../constants/theme";

export function LoaderSkeleton() {
  return (
    <View style={styles.container}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.block} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  block: {
    height: 78,
    borderRadius: 16,
    backgroundColor: "rgba(39,39,42,0.8)",
    borderWidth: 1,
    borderColor: theme.border,
  },
});

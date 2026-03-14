import React from "react";
import { StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";

import { theme } from "../constants/theme";

interface TextFieldProps extends TextInputProps {
  label: string;
}

export function TextField({ label, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={theme.mutedText}
        style={[styles.input, inputProps.style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  label: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: theme.text,
    backgroundColor: "rgba(39,39,42,0.55)",
    fontSize: 15,
  },
});

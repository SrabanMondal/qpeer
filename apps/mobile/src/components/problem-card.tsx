import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Card, Icon } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import type { JoinProblem } from "@/lib/join-errors";

/**
 * What went wrong and the one fix the app can offer (join, check-in,
 * "I'm here", payments). `retry` is left to the screen's main button.
 * An error-container card with an icon, so it sits next to what failed.
 */
export function ProblemCard({
  problem,
  onFix,
}: {
  problem: JoinProblem;
  onFix: (p: JoinProblem) => void;
}) {
  const fix =
    problem.fix === "open_settings"
      ? { title: "Open settings", icon: "settings" as const }
      : problem.fix === "turn_on_location"
        ? { title: "Turn on location", icon: "my_location" as const }
        : problem.fix === "open_ticket"
          ? { title: "Open my ticket", icon: "confirmation_number" as const }
          : problem.fix === "sign_in"
            ? { title: "Sign in", icon: "login" as const }
            : null;
  return (
    <Card tone="errorContainer">
      <View style={styles.head}>
        <Icon name="error" color="onErrorContainer" />
        <ThemedText
          type="titleMedium"
          themeColor="onErrorContainer"
          style={styles.flex}
        >
          {problem.title}
        </ThemedText>
      </View>
      <ThemedText type="bodyLarge" themeColor="onErrorContainer">
        {problem.message}
      </ThemedText>
      {problem.support ? (
        <ThemedText type="bodySmall" themeColor="onErrorContainer" selectable>
          {problem.support}
        </ThemedText>
      ) : null}
      {fix ? (
        <Button
          title={fix.title}
          variant="outlined"
          icon={fix.icon}
          onPress={() => onFix(problem)}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  flex: { flex: 1 },
});

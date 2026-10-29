import { ThemedText } from "@/components/themed-text";
import { Button, Card } from "@/components/ui";
import type { JoinProblem } from "@/lib/join-errors";

/**
 * What went wrong and the one fix the app can offer (join, check-in,
 * "I'm here", payments). `retry` is left to the screen's main button.
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
    <Card>
      <ThemedText type="heading" themeColor="danger">
        {problem.title}
      </ThemedText>
      <ThemedText type="body">{problem.message}</ThemedText>
      {problem.support ? (
        <ThemedText type="small" themeColor="inkMuted" selectable>
          {problem.support}
        </ThemedText>
      ) : null}
      {fix ? (
        <Button
          title={fix.title}
          variant="secondary"
          icon={fix.icon}
          onPress={() => onFix(problem)}
        />
      ) : null}
    </Card>
  );
}

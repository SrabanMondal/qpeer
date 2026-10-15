import { ConnectionBanner, EmptyState, Screen } from "@/components/ui";
import { useAppMode } from "@/lib/mode";

/** Customer: my tickets. Business: queue console. Both arrive in Step 2. */
export default function QueueTab() {
  const { mode } = useAppMode();
  return (
    <Screen bottomInset={false}>
      <ConnectionBanner />
      {mode === "business" ? (
        <EmptyState
          icon="queue"
          title="Queue console"
          message="Queue console arrives in Step 2. You will call the next person, pause, skip and see who is waiting."
        />
      ) : (
        <EmptyState
          icon="confirmation_number"
          title="No tickets yet"
          message="Your tickets appear here in Step 2, with your number, people ahead and when to leave home."
        />
      )}
    </Screen>
  );
}

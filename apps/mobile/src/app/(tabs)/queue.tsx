import { useAppMode } from "@/lib/mode";
import { MyTokens } from "@/screens/my-tokens";
import { QueueConsole } from "@/screens/queue-console";

/** Customer: my tickets (TOK-06). Business: the queue console (Step 2). */
export default function QueueTab() {
  const { mode } = useAppMode();
  return mode === "business" ? <QueueConsole /> : <MyTokens />;
}

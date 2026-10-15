import { HeaderButton } from "@/components/ui/header-button";
import { StatusBanner } from "@/components/ui/status-banner";
import { useAuth } from "@/lib/auth";

/**
 * Non-blocking "Connecting…" strip while the automatic anonymous sign-in is
 * being retried (IDN-01). Renders nothing once a user exists.
 */
export function ConnectionBanner() {
  const { connecting, error, retry } = useAuth();
  if (!connecting) return null;
  return (
    <StatusBanner
      tone="paused"
      title="Connecting…"
      detail={error ? `${error} Trying again automatically.` : undefined}
      right={<HeaderButton title="Retry" onPress={retry} />}
    />
  );
}

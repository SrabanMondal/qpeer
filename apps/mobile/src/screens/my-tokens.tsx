import type { TokenSummary } from "@qpeer/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { type ReactNode, useCallback } from "react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
} from "@/components/ui";
import { useMyTokens } from "@/lib/api";
import {
  formatClock,
  formatDateTime,
  tokenStatusBadge,
} from "@/lib/queue-format";

/** Customer Queue tab: "My tokens" — active first, then recent (TOK-06). */
export function MyTokens() {
  const router = useRouter();
  const active = useMyTokens("active");
  const recent = useMyTokens("recent");

  const refetchActive = active.refetch;
  const refetchRecent = recent.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchActive();
      void refetchRecent();
    }, [refetchActive, refetchRecent]),
  );

  const scan = () => router.push("/scan");
  const open = (t: TokenSummary) =>
    router.push({ pathname: "/token/[id]", params: { id: t.id } });

  const activeItems = active.data?.items ?? [];
  const activeIds = new Set(activeItems.map((t) => t.id));
  const recentItems = (recent.data?.items ?? []).filter(
    (t) => !activeIds.has(t.id),
  );

  let body: ReactNode;
  if (active.isPending) {
    body = <LoadingState label="Loading your tickets…" />;
  } else if (active.isError) {
    body = (
      <ErrorState
        title="Could not load your tickets"
        error={active.error}
        onRetry={() => active.refetch()}
        retrying={active.isFetching}
      />
    );
  } else if (activeItems.length === 0 && recentItems.length === 0) {
    body = (
      <EmptyState
        icon="confirmation_number"
        title="No tickets yet"
        message="At a clinic, lab or salon using Qpeer, scan the QR code at the counter to join its queue."
        action={
          <Button
            title="Scan QR to join"
            variant="brand"
            icon="qr_code_scanner"
            onPress={scan}
          />
        }
      />
    );
  } else {
    body = (
      <>
        <SectionHeader title="Active" />
        {activeItems.length === 0 ? (
          <EmptyState
            icon="confirmation_number"
            title="No active tickets"
            message="Scan a queue's QR code to join."
          />
        ) : (
          activeItems.map((t) => {
            const badge = tokenStatusBadge(t);
            return (
              <ListItem
                key={t.id}
                icon="confirmation_number"
                title={`#${t.label} · ${t.queueName}`}
                subtitle={`${t.businessName} · joined ${formatClock(t.joinedAt)}`}
                footer={<Badge label={badge.label} tone={badge.tone} />}
                accessibilityLabel={`Ticket ${t.label}, ${t.queueName}, ${t.businessName}, ${badge.label}`}
                onPress={() => open(t)}
              />
            );
          })
        )}
        {recentItems.length > 0 ? (
          <>
            <SectionHeader title="Recent" />
            {recentItems.map((t) => {
              const badge = tokenStatusBadge(t);
              return (
                <ListItem
                  key={t.id}
                  icon="history"
                  title={`#${t.label} · ${t.queueName}`}
                  subtitle={`${t.businessName} · ${formatDateTime(t.endedAt ?? t.joinedAt)}`}
                  footer={<Badge label={badge.label} tone={badge.tone} />}
                  onPress={() => open(t)}
                />
              );
            })}
          </>
        ) : recent.isError ? (
          <ErrorState
            title="Could not load your history"
            error={recent.error}
            onRetry={() => recent.refetch()}
            retrying={recent.isFetching}
          />
        ) : null}
      </>
    );
  }

  return (
    <Screen
      bottomInset={false}
      refreshing={active.isRefetching || recent.isRefetching}
      onRefresh={() => {
        void active.refetch();
        void recent.refetch();
      }}
    >
      {activeItems.length > 0 || recentItems.length > 0 ? (
        <Button
          title="Scan QR to join"
          variant="brand"
          icon="qr_code_scanner"
          onPress={scan}
        />
      ) : null}
      {body}
    </Screen>
  );
}

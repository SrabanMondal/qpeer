import { isActiveState, type TokenSummary } from "@qpeer/shared";
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
import { useAuth } from "@/lib/auth";
import { useOffline } from "@/lib/network";
import {
  formatAge,
  formatClock,
  formatDateTime,
  ticketTitle,
  tokenStatusBadge,
} from "@/lib/queue-format";
import { useSavedTickets } from "@/lib/storage";

/** Customer Queue tab: "My tokens" — active first, then recent (TOK-06). */
export function MyTokens() {
  const router = useRouter();
  const active = useMyTokens("active");
  const recent = useMyTokens("recent");
  const uid = useAuth().user?.uid ?? null;
  const saved = useSavedTickets(uid);
  const offline = useOffline();

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

  // C1: no answer yet (offline, cold start): the tickets saved on the phone.
  const savedActive = saved.tickets.filter((t) => isActiveState(t.view.state));
  let body: ReactNode;
  if (!active.data && savedActive.length > 0) {
    body = (
      <>
        <SectionHeader title="Active (saved on this phone)" />
        {savedActive.map(({ view: t, savedAt }) => {
          const badge = tokenStatusBadge(t);
          return (
            <ListItem
              key={t.id}
              icon="confirmation_number"
              title={`${ticketTitle(t)} · ${t.queueName}`}
              subtitle={`${t.businessName} · updated ${formatAge(savedAt)}`}
              footer={<Badge label={badge.label} tone={badge.tone} />}
              onPress={() =>
                router.push({ pathname: "/token/[id]", params: { id: t.id } })
              }
            />
          );
        })}
      </>
    );
  } else if (active.isPending && offline) {
    body = (
      <EmptyState
        icon="cloud_off"
        title="No saved tickets"
        message="Your tickets show here as soon as you're online."
      />
    );
  } else if (active.isPending) {
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
            size="large"
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
                title={`${ticketTitle(t)} · ${t.queueName}`}
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
                  title={`${ticketTitle(t)} · ${t.queueName}`}
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
          size="large"
          icon="qr_code_scanner"
          onPress={scan}
        />
      ) : null}
      {body}
    </Screen>
  );
}

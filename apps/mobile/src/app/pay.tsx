import { approxDuration, type OrderResponse, waitText } from "@qpeer/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { PriorityChip } from "@/components/priority-chip";
import { ProblemCard } from "@/components/problem-card";
import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  InfoRow,
  LoadingState,
  Screen,
  SectionHeader,
  StatusBanner,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  orderFor,
  type PayKind,
  queryKeys,
  storeToken,
  useMe,
  usePriorityPreview,
  useQueue,
  useToken,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { formatRupees } from "@/lib/format";
import { type JoinProblem, payErrorView } from "@/lib/join-errors";
import { OFFLINE_ACTION_TEXT, useOffline } from "@/lib/network";
import {
  confirmCheckout,
  existingTicketId,
  type PayOutcome,
} from "@/lib/pay-flow";
import { payRules } from "@/lib/pay-rules";
import { useNow } from "@/lib/queue-format";
import { openCheckout } from "@/lib/razorpay";
import { showToast } from "@/lib/toast";
import { PriorityPreviewCard } from "@/screens/priority-preview-card";

type Phase =
  | { kind: "idle" }
  | { kind: "paying" }
  | { kind: "confirming" }
  /** Checkout closed or failed; nothing was charged. */
  | { kind: "not_paid"; message: string }
  | { kind: "done"; outcome: Exclude<PayOutcome, { kind: "ticket" }> };

const TITLES: Record<PayKind, string> = {
  reservation: "Reserve a place",
  priority: "Priority Pass",
  upgrade: "Skip ahead",
};

function isPayKind(v: unknown): v is PayKind {
  return v === "reservation" || v === "priority" || v === "upgrade";
}

/**
 * Step 4 payments (PAY-01…05, PRI-02, PRI-05): what you buy, the honest
 * preview, the rules (PAY-02), then Razorpay Checkout with the server's key
 * id + order id. Success → verify on the server → the ticket. The webhook
 * also confirms, so a missing confirmation is polled ("payment pending").
 */
export default function PayScreen() {
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    kind?: string;
    queueId?: string;
    tokenId?: string;
  }>();
  const kind: PayKind = isPayKind(params.kind) ? params.kind : "reservation";
  const queueId = params.queueId ?? "";
  const tokenId = params.tokenId ?? "";
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const registered = user !== null && !user.isAnonymous;
  const offline = useOffline();
  const me = useMe();
  const now = useNow(true, 15_000);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const queue = useQueue(kind === "upgrade" ? "" : queueId);
  const preview = usePriorityPreview(queueId, kind === "priority");
  const ticket = useToken(kind === "upgrade" ? tokenId : "");

  // The order is made on the server first: its rules (PAY-02) come with it.
  // Retrying returns the same unpaid order, so a refetch is harmless.
  const order = useQuery({
    queryKey: ["order", uid, kind, queueId, tokenId],
    queryFn: () => orderFor({ kind, queueId, tokenId }),
    enabled: registered && queueId.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const showTicket = (id: string) => {
    if (kind === "upgrade" && router.canGoBack()) router.back();
    else router.replace({ pathname: "/token/[id]", params: { id } });
  };

  // One active ticket per person per queue: an order answered 409
  // `already_in_queue` (e.g. the webhook already made the ticket and the app
  // lost the answer, or this ticket's upgrade is already paid) opens the
  // ticket the user holds instead of showing an error.
  const existing = order.isError ? existingTicketId(order.error) : null;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!existing || opened.current === existing) return;
    opened.current = existing;
    showToast({
      title: "You already have a ticket here",
      message: "One ticket per person per queue.",
    });
    if (kind === "upgrade" && existing === tokenId && router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: "/token/[id]", params: { id: existing } });
    }
  }, [existing, kind, tokenId, router]);

  const pay = async (o: OrderResponse) => {
    if (phase.kind === "paying" || phase.kind === "confirming") return;
    let current = o;
    // An order can be paid for 30 min; past that make (or fetch) a fresh one.
    if (serverNow() > current.expiresAt - 60_000) {
      const fresh = await order.refetch();
      if (!fresh.data) return;
      current = fresh.data;
    }
    setPhase({ kind: "paying" });
    const profile = me.data?.user;
    const result = await openCheckout(
      current,
      {
        name: profile?.displayName,
        email: profile?.email,
        phone: profile?.phone,
      },
      theme.brand,
    );
    if (result.kind === "unavailable") {
      setPhase({
        kind: "not_paid",
        message:
          "Payments are not available in this version of the app. Update Qpeer and try again. You were not charged.",
      });
      return;
    }
    if (result.kind === "dismissed") {
      setPhase({
        kind: "not_paid",
        message:
          "Payment not completed. You were not charged. Tap Pay to try again.",
      });
      return;
    }
    if (result.kind === "failed") {
      setPhase({
        kind: "not_paid",
        message: `${result.message} You were not charged. Try again, or use another payment method.`,
      });
      return;
    }
    setPhase({ kind: "confirming" });
    const outcome = await confirmCheckout(current, result).catch(
      (): PayOutcome => ({ kind: "pending" }),
    );
    void queryClient.invalidateQueries({
      queryKey: queryKeys.myPayments(uid),
    });
    if (outcome.kind === "ticket") {
      storeToken(queryClient, uid, outcome.token);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.queue(uid, current.queueId),
      });
      showToast({
        title:
          kind === "priority"
            ? "Priority Pass bought"
            : kind === "upgrade"
              ? "You moved to the priority lane"
              : "Your place is reserved",
        tone: "success",
      });
      showTicket(outcome.token.id);
      return;
    }
    setPhase({ kind: "done", outcome });
  };

  const onFix = (p: JoinProblem) => {
    if (p.fix === "sign_in") router.push("/sign-in");
    else if (p.fix === "open_ticket" && p.tokenId) {
      router.replace({ pathname: "/token/[id]", params: { id: p.tokenId } });
    }
  };

  if (!queueId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Payment" }} />
        <EmptyState
          icon="error"
          title="Nothing to pay for"
          message="Open a queue first, then choose what to buy."
        />
      </Screen>
    );
  }

  const o = order.data;
  const busy = phase.kind === "paying" || phase.kind === "confirming";
  const soldOut = kind === "priority" && preview.data?.soldOut === true;
  const priority =
    kind === "upgrade"
      ? (ticket.data?.priority ?? null)
      : (queue.data?.priority ?? queue.data?.queue.priority ?? null);

  return (
    <Screen
      refreshing={order.isRefetching}
      onRefresh={() => {
        if (!busy) {
          void order.refetch();
          void preview.refetch();
        }
      }}
    >
      <Stack.Screen options={{ title: TITLES[kind] }} />

      <Card>
        <ThemedText type="label" themeColor="inkMuted">
          {TITLES[kind].toUpperCase()}
        </ThemedText>
        <ThemedText type="title">
          {o?.businessName ??
            queue.data?.business.name ??
            ticket.data?.businessName ??
            " "}
        </ThemedText>
        <ThemedText type="heading" themeColor="inkMuted">
          {o?.queueName ?? queue.data?.queue.name ?? ticket.data?.queueName}
        </ThemedText>
        <PriorityChip priority={priority} />
      </Card>

      {kind === "priority" && preview.data ? (
        <PriorityPreviewCard preview={preview.data} now={now} />
      ) : null}

      {kind === "upgrade" && ticket.data?.upgrade ? (
        <Card>
          <ThemedText type="heading">
            {`Skip ahead · about ${ticket.data.upgrade.savingMin} min faster`}
          </ThemedText>
          <InfoRow label="Your ticket" value={`#${ticket.data.label}`} />
          {ticket.data.etaLowMs !== null && ticket.data.etaHighMs !== null ? (
            <InfoRow
              label="Your wait now"
              value={approxDuration(
                ticket.data.etaLowMs - now,
                ticket.data.etaHighMs - now,
              )}
            />
          ) : null}
          <ThemedText type="small" themeColor="inkMuted">
            Your ticket keeps its number and moves to the priority lane as soon
            as the payment is confirmed. No new check-in needed.
          </ThemedText>
        </Card>
      ) : null}

      {kind === "reservation" && queue.data ? (
        <Card>
          <InfoRow
            label="People waiting"
            value={String(queue.data.live.waiting)}
          />
          <InfoRow
            label="Estimated wait"
            value={
              queue.data.live.status === "open"
                ? (waitText(queue.data.live, now) ?? "Not known yet")
                : "—"
            }
          />
          <ThemedText type="small" themeColor="inkMuted">
            Your place is held from now. We alert you when it's time to head to
            the business.
          </ThemedText>
        </Card>
      ) : null}

      {!registered ? (
        <ProblemCard
          problem={{
            title: "Sign in to pay",
            message:
              "Paid places are tied to your account, so sign in with your phone or Google first. Your free tickets stay with you.",
            fix: "sign_in",
          }}
          onFix={onFix}
        />
      ) : soldOut ? (
        <StatusBanner
          tone="closed"
          title="Sold out for today"
          detail="All of today's Priority Passes for this queue are sold. You can still join the regular queue."
        />
      ) : existing ? (
        <LoadingState label="Opening your ticket…" />
      ) : order.isError ? (
        <>
          <ProblemCard problem={payErrorView(order.error)} onFix={onFix} />
          {payErrorView(order.error).fix === "retry" ? (
            <Button
              title="Try again"
              variant="secondary"
              icon="refresh"
              loading={order.isFetching}
              onPress={() => void order.refetch()}
              needsNetwork
            />
          ) : null}
        </>
      ) : !o ? (
        offline ? (
          <ErrorState
            title="You're offline"
            error={new Error(OFFLINE_ACTION_TEXT)}
            onRetry={() => void order.refetch()}
            retrying={order.isFetching}
          />
        ) : (
          <LoadingState label="Preparing your payment…" />
        )
      ) : (
        <>
          <SectionHeader title="Before you pay" />
          <Card>
            <View style={styles.feeRow}>
              <ThemedText type="body" themeColor="inkMuted">
                Fee
              </ThemedText>
              <ThemedText type="title">
                {formatRupees(o.amountPaise)}
              </ThemedText>
            </View>
            {payRules(o).map((line) => (
              <View key={line} style={styles.rule}>
                <Icon name="check_circle" size={18} color="brand" />
                <ThemedText type="small" style={styles.flex}>
                  {line}
                </ThemedText>
              </View>
            ))}
          </Card>

          {phase.kind === "not_paid" ? (
            <StatusBanner
              tone="paused"
              title="Not paid"
              detail={phase.message}
            />
          ) : null}

          {phase.kind === "done" && phase.outcome.kind === "refunded" ? (
            <Card>
              <ThemedText type="heading" themeColor="danger">
                {phase.outcome.title}
              </ThemedText>
              <ThemedText type="body">{phase.outcome.message}</ThemedText>
              <Button
                title="See my payments"
                variant="secondary"
                icon="receipt_long"
                onPress={() => router.push("/payments" as Href)}
              />
            </Card>
          ) : phase.kind === "done" ? (
            <Card>
              <ThemedText type="heading">
                Payment received — confirming
              </ThemedText>
              <ThemedText type="body">
                Razorpay took the payment and Qpeer is still confirming it. Your
                ticket appears in the Queue tab as soon as it is confirmed. If
                no ticket can be made, the full fee is refunded automatically.
              </ThemedText>
              <Button
                title="See my payments"
                variant="secondary"
                icon="receipt_long"
                onPress={() => router.push("/payments" as Href)}
              />
            </Card>
          ) : (
            <Button
              title={
                phase.kind === "confirming"
                  ? "Confirming your payment…"
                  : kind === "priority"
                    ? `Buy Priority Pass · ${formatRupees(o.amountPaise)}`
                    : `Pay ${formatRupees(o.amountPaise)}`
              }
              variant="brand"
              icon="payments"
              loading={busy}
              onPress={() => void pay(o)}
              needsNetwork
            />
          )}
          <ThemedText type="small" themeColor="inkMuted">
            {phase.kind === "confirming"
              ? "Keep this screen open for a few seconds."
              : "Payments run through Razorpay (test mode in this version: no real money). Qpeer never sees your card or UPI details."}
          </ThemedText>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rule: { flexDirection: "row", gap: Spacing.two, alignItems: "flex-start" },
  flex: { flex: 1 },
});

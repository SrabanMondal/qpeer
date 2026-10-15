import type { ConsoleState, ConsoleToken } from "@qpeer/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  ChoiceChips,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Screen,
  SectionHeader,
  StatRow,
  StatusBanner,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  type ConsoleCommand,
  queryKeys,
  storeConsole,
  useConsole,
  useConsoleCommand,
  useMyBusinesses,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLiveSocket } from "@/lib/live";
import {
  formatClock,
  formatCountdown,
  formatWaitRange,
  liveStatusLook,
  METHOD_LABELS,
  useNow,
} from "@/lib/queue-format";
import { showErrorToast, showToast } from "@/lib/toast";

/** The console's chosen queue, kept for this app run (no storage module yet). */
let rememberedQueueId: string | null = null;

/** Waiting rows drawn at most; the rest is summarised. */
const MAX_WAITING_ROWS = 50;

type ConsoleQueue = {
  id: string;
  name: string;
  businessName: string;
  joinRadiusM: number | null;
};

function useConsoleQueues() {
  const list = useMyBusinesses();
  const queues: ConsoleQueue[] = [];
  for (const b of list.data?.items ?? []) {
    for (const q of b.queues) {
      if (q.status !== "active") continue;
      queues.push({
        id: q.id,
        name: q.name,
        businessName: b.name,
        joinRadiusM: q.settings?.joinRadiusM ?? null,
      });
    }
  }
  return { list, queues };
}

/**
 * Business mode Queue tab: the staff console (BIZ-13, QUE-05–12, ALR-07).
 * Follows service-provider-interface.png.
 */
export function QueueConsole() {
  const router = useRouter();
  const { list, queues } = useConsoleQueues();
  const [selected, setSelected] = useState<string | null>(rememberedQueueId);
  const current = queues.find((q) => q.id === selected) ?? queues[0] ?? null;

  if (list.isPending) {
    return (
      <Screen bottomInset={false}>
        <LoadingState label="Loading your queues…" />
      </Screen>
    );
  }
  if (list.isError) {
    return (
      <Screen bottomInset={false}>
        <ErrorState
          title="Could not load your queues"
          error={list.error}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      </Screen>
    );
  }
  if (!current) {
    const first = list.data.items[0];
    return (
      <Screen bottomInset={false}>
        {first ? (
          <EmptyState
            icon="queue"
            title="Create a queue first"
            message="The console runs a queue: call the next person, pause, skip and see who is waiting."
            action={
              <Button
                title="Create a queue"
                icon="add"
                onPress={() =>
                  router.push({
                    pathname: "/business/[id]/new-queue",
                    params: { id: first.id },
                  })
                }
              />
            }
          />
        ) : (
          <EmptyState
            icon="storefront"
            title="Set up your business first"
            message="Add your business and a queue, then run it from here."
            action={
              <Button
                title="Create business"
                icon="add"
                onPress={() => router.push("/business/new")}
              />
            }
          />
        )}
      </Screen>
    );
  }

  return (
    <ConsoleBody
      // A different queue starts with fresh local state (counter, notices).
      key={current.id}
      queue={current}
      picker={
        queues.length > 1 ? (
          <ChoiceChips
            label="Queue"
            value={current.id}
            options={queues.map((q) => ({
              value: q.id,
              label:
                new Set(queues.map((x) => x.businessName)).size > 1
                  ? `${q.name} · ${q.businessName}`
                  : q.name,
            }))}
            onChange={(id) => {
              rememberedQueueId = id;
              setSelected(id);
            }}
          />
        ) : null
      }
      refreshList={() => {
        void list.refetch();
      }}
    />
  );
}

function ConsoleBody({
  queue,
  picker,
  refreshList,
}: {
  queue: ConsoleQueue;
  picker: ReactNode;
  refreshList: () => void;
}) {
  const uid = useAuth().user?.uid ?? null;
  const queryClient = useQueryClient();
  const consoleQ = useConsole(queue.id);
  const command = useConsoleCommand(queue.id);
  const [counter, setCounter] = useState(1);
  const ownNoShows = useRef(new Set<string>());
  const seenGrace = useRef<Set<string> | null>(null);
  const state = consoleQ.data;

  const live = useLiveSocket({
    queueId: queue.id,
    query: "console=1",
    enabled: uid !== null,
    onOpen: () => {
      void consoleQ.refetch();
    },
    onMessage: (m) => {
      if (m.type === "queue" && m.console.queueId === queue.id) {
        storeConsole(queryClient, uid, m.console);
      }
    },
  });

  const refetchConsole = consoleQ.refetch;
  useFocusEffect(
    useCallback(() => {
      const s = queryClient.getQueryState(queryKeys.console(uid, queue.id));
      if (s && Date.now() - s.dataUpdatedAt > 2000) void refetchConsole();
    }, [queryClient, uid, queue.id, refetchConsole]),
  );

  // ALR-07: a small notice when someone lands in the grace list (late).
  useEffect(() => {
    if (!state) return;
    const ids = new Set(state.grace.map((g) => g.id));
    const before = seenGrace.current;
    seenGrace.current = ids;
    if (!before) return;
    const fresh = state.grace.filter(
      (g) => !before.has(g.id) && !ownNoShows.current.has(g.id),
    );
    if (fresh.length > 0) {
      showToast({
        title: `#${fresh[0].label} is late`,
        message: "They are in the grace list. Tap Admit when they arrive.",
        tone: "warning",
      });
    }
  }, [state]);

  const undoActive = state?.undoUntil != null;
  const now = useNow(Boolean(undoActive || (state && state.grace.length > 0)));

  if (!state) {
    return (
      <Screen bottomInset={false}>
        {picker}
        {consoleQ.isError ? (
          <ErrorState
            title="Could not load the console"
            error={consoleQ.error}
            onRetry={() => consoleQ.refetch()}
            retrying={consoleQ.isFetching}
          />
        ) : (
          <LoadingState label="Loading the console…" />
        )}
      </Screen>
    );
  }

  const busy = command.isPending;
  const run = async (cmd: ConsoleCommand, errorTitle: string) => {
    if (command.isPending) return false;
    if (cmd.kind === "token" && cmd.action === "no-show") {
      ownNoShows.current.add(cmd.tokenId);
    }
    try {
      await command.mutateAsync(cmd);
      return true;
    } catch (e) {
      showErrorToast(errorTitle, e);
      void consoleQ.refetch();
      return false;
    }
  };

  return (
    <Screen
      bottomInset={false}
      refreshing={consoleQ.isRefetching}
      onRefresh={() => {
        void consoleQ.refetch();
        refreshList();
      }}
    >
      {picker}
      <ConsoleView
        state={state}
        queue={queue}
        live={live === "live"}
        busy={busy}
        now={now}
        counter={Math.min(counter, state.counters)}
        setCounter={setCounter}
        run={run}
      />
    </Screen>
  );
}

function ConsoleView({
  state,
  queue,
  live,
  busy,
  now,
  counter,
  setCounter,
  run,
}: {
  state: ConsoleState;
  queue: ConsoleQueue;
  live: boolean;
  busy: boolean;
  now: number;
  counter: number;
  setCounter: (c: number) => void;
  run: (cmd: ConsoleCommand, errorTitle: string) => Promise<boolean>;
}) {
  const theme = useTheme();
  const status = liveStatusLook(state.status);
  const closed = state.status === "closed";
  const paused = state.status === "paused";
  const multi = state.counters > 1;
  const atCounter =
    state.serving.find((s) => s.counter === counter) ??
    (multi ? undefined : state.serving[0]);
  const canNext =
    !closed && !paused && (state.counts.waiting > 0 || atCounter !== undefined);
  const undoLeft =
    state.undoUntil !== null ? Math.max(0, state.undoUntil - now) : 0;

  const onTriage = async () => {
    const ok = await ConfirmDialog.show({
      title: "Add a priority (triage) token?",
      message: `A T-token goes to the front of the waiting list, for urgent cases. ${state.triageLeftToday} left today.`,
      confirmLabel: "Add to front",
      destructive: false,
    });
    if (!ok) return;
    if (await run({ kind: "triage" }, "Could not add a triage token")) {
      showToast({ title: "Triage token added at the front", tone: "success" });
    }
  };

  const onClose = async () => {
    const left = state.counts.total;
    const ok = await ConfirmDialog.show({
      title: "Close for the day?",
      message:
        left > 0
          ? `${left} ${left === 1 ? "ticket is" : "tickets are"} still active. They will expire and those customers are told the queue closed. Numbers start again at 1 when you open next time.`
          : "Nobody can join until you open the queue again. Numbers start again at 1 next time.",
      confirmLabel: "Close queue",
    });
    if (ok) await run({ kind: "queue", action: "close" }, "Could not close");
  };

  const waitingMenu = (t: ConsoleToken) => {
    Alert.alert(`#${t.label}`, "Waiting", [
      {
        text: "Skip (move back 3 places)",
        onPress: () =>
          void run(
            { kind: "token", action: "skip", tokenId: t.id },
            "Could not skip",
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <>
      <StatusBanner
        tone={status.tone}
        title={
          closed
            ? "Closed"
            : paused
              ? "Paused — nobody is called"
              : "Open — service active"
        }
        detail={`Walk-in check: GPS · ${queue.joinRadiusM ?? "—"} m`}
        right={
          <Badge
            label={live ? "Live" : "Reconnecting"}
            tone={live ? "success" : "warning"}
          />
        }
      />

      {closed ? (
        <Card style={styles.centreCard}>
          <ThemedText type="heading">{queue.name} is closed</ThemedText>
          <ThemedText
            type="small"
            themeColor="inkMuted"
            style={styles.centreText}
          >
            Open it to start today's session. Customers can then scan the QR
            code and join.
          </ThemedText>
          <Button
            title="Open queue"
            icon="lock_open"
            variant="brand"
            loading={busy}
            onPress={() =>
              void run({ kind: "queue", action: "open" }, "Could not open")
            }
            style={styles.stretch}
          />
        </Card>
      ) : (
        <>
          <Card style={styles.centreCard}>
            <ThemedText type="heading">Now Serving</ThemedText>
            <ThemedText type="display" accessibilityLiveRegion="polite">
              {state.nowServing ? `#${state.nowServing}` : "—"}
            </ThemedText>
            {multi && state.serving.length > 0 ? (
              <ThemedText type="small" themeColor="inkMuted">
                {state.serving
                  .map((s) => `Counter ${s.counter ?? "?"}: #${s.label}`)
                  .join(" · ")}
              </ThemedText>
            ) : null}
          </Card>

          {multi ? (
            <ChoiceChips
              label="Your counter"
              value={String(counter)}
              options={Array.from({ length: state.counters }, (_, i) => ({
                value: String(i + 1),
                label: `Counter ${i + 1}`,
              }))}
              onChange={(v) => setCounter(Number(v))}
            />
          ) : null}

          <Button
            title={paused ? "Paused" : canNext ? "NEXT" : "Nobody waiting"}
            icon="fast_forward"
            accessibilityLabel={
              multi ? `Call next to counter ${counter}` : "Call next"
            }
            loading={busy}
            disabled={!canNext}
            onPress={() =>
              void run(
                {
                  kind: "queue",
                  action: "next",
                  counter: multi ? counter : undefined,
                },
                "Could not call next",
              )
            }
            style={styles.next}
          />

          {undoLeft > 0 ? (
            <View
              style={[styles.undo, { backgroundColor: theme.header }]}
              accessibilityLiveRegion="polite"
            >
              <ThemedText
                type="body"
                themeColor="onPrimary"
                style={styles.flex}
              >
                Called #{state.nowServing ?? "?"} · undo in{" "}
                {formatCountdown(undoLeft)}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Undo the last Next"
                disabled={busy}
                hitSlop={8}
                onPress={() =>
                  void run(
                    { kind: "queue", action: "undo-next" },
                    "Could not undo",
                  )
                }
                style={({ pressed }) => [
                  styles.undoButton,
                  (pressed || busy) && styles.dim,
                ]}
              >
                <Icon name="undo" color="onPrimary" />
                <ThemedText type="body" themeColor="onPrimary">
                  UNDO
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.grid}>
            <Button
              title={paused ? "Resume" : "Pause"}
              icon={paused ? "play_arrow" : "pause"}
              variant="secondary"
              disabled={busy}
              onPress={() =>
                void run(
                  { kind: "queue", action: paused ? "resume" : "pause" },
                  paused ? "Could not resume" : "Could not pause",
                )
              }
              style={styles.cell}
            />
            <Button
              title="Skip"
              icon="skip_next"
              variant="secondary"
              accessibilityLabel={
                atCounter ? `Skip #${atCounter.label}` : "Skip"
              }
              disabled={busy || !atCounter}
              onPress={() => {
                if (atCounter) {
                  void run(
                    { kind: "token", action: "skip", tokenId: atCounter.id },
                    "Could not skip",
                  );
                }
              }}
              style={styles.cell}
            />
            <Button
              title={
                state.triageLeftToday > 0
                  ? `Priority (${state.triageLeftToday})`
                  : "Priority (0)"
              }
              icon="emergency"
              variant="danger-soft"
              accessibilityLabel={`Priority triage, ${state.triageLeftToday} left today`}
              disabled={busy || state.triageLeftToday <= 0}
              onPress={() => void onTriage()}
              style={styles.cell}
            />
            <Button
              title="Add person"
              icon="person_add"
              variant="secondary"
              accessibilityLabel="Add person, coming soon"
              disabled
              onPress={() => undefined}
              style={styles.cell}
            />
          </View>
          <ThemedText type="small" themeColor="inkMuted">
            Add person (for customers without the app) is coming soon.
          </ThemedText>
        </>
      )}

      <StatRow
        stats={[
          { label: "Waiting", value: state.counts.waiting, icon: "groups" },
          {
            label: "In service",
            value: state.counts.inService,
            icon: "person",
          },
          { label: "Total", value: state.counts.total, icon: "groups" },
        ]}
      />
      {!closed &&
      state.eta.waitLowMs !== null &&
      state.eta.waitHighMs !== null ? (
        <ThemedText type="small" themeColor="inkMuted">
          Someone joining now waits{" "}
          {formatWaitRange(state.eta.waitLowMs, state.eta.waitHighMs)}
          {state.eta.coldStart ? " (estimate from your settings)" : ""}.
        </ThemedText>
      ) : null}

      {state.serving.length > 0 ? (
        <>
          <SectionHeader title={`Called (${state.serving.length})`} />
          {state.serving.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              detail={`${t.counter !== null ? `Counter ${t.counter} · ` : ""}called ${t.calledAt ? formatClock(t.calledAt) : ""}`}
              actions={
                <>
                  <Button
                    title="Served"
                    icon="check"
                    variant="secondary"
                    disabled={busy}
                    onPress={() =>
                      void run(
                        { kind: "token", action: "served", tokenId: t.id },
                        "Could not mark served",
                      )
                    }
                    style={styles.rowButton}
                  />
                  <Button
                    title="No-show"
                    icon="person_off"
                    variant="danger-soft"
                    disabled={busy}
                    onPress={() =>
                      void run(
                        { kind: "token", action: "no-show", tokenId: t.id },
                        "Could not mark no-show",
                      )
                    }
                    style={styles.rowButton}
                  />
                </>
              }
            />
          ))}
        </>
      ) : null}

      {state.grace.length > 0 ? (
        <>
          <SectionHeader title={`Late — grace (${state.grace.length})`} />
          {state.grace.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              detail={
                t.graceUntil !== null && t.graceUntil > now
                  ? `${formatCountdown(t.graceUntil - now)} left to arrive`
                  : "Time is up — expiring"
              }
              actions={
                <Button
                  title="Admit"
                  icon="login"
                  disabled={busy}
                  onPress={() =>
                    void run(
                      { kind: "token", action: "admit", tokenId: t.id },
                      "Could not admit",
                    )
                  }
                  style={styles.rowButton}
                />
              }
            />
          ))}
        </>
      ) : null}

      {!closed ? (
        <>
          <SectionHeader title={`Waiting (${state.counts.waiting})`} />
          {state.waiting.length === 0 ? (
            <Card>
              <ThemedText type="small" themeColor="inkMuted">
                Nobody is waiting. New joiners appear here at once.
              </ThemedText>
            </Card>
          ) : (
            state.waiting.slice(0, MAX_WAITING_ROWS).map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                detail={`${t.position !== null ? `${t.position}. ` : ""}joined ${formatClock(t.joinedAt)}`}
                onLongPress={() => waitingMenu(t)}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Actions for #${t.label}`}
                    disabled={busy}
                    hitSlop={8}
                    onPress={() => waitingMenu(t)}
                    style={({ pressed }) => [
                      styles.menuButton,
                      (pressed || busy) && styles.dim,
                    ]}
                  >
                    <Icon name="more_vert" color="inkMuted" />
                  </Pressable>
                }
              />
            ))
          )}
          {state.waiting.length > MAX_WAITING_ROWS ? (
            <ThemedText type="small" themeColor="inkMuted">
              and {state.waiting.length - MAX_WAITING_ROWS} more…
            </ThemedText>
          ) : null}

          <SectionHeader title="End of day" />
          <Button
            title="Close for the day"
            icon="stop_circle"
            variant="danger-soft"
            disabled={busy}
            onPress={() => void onClose()}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * One token in a console list: number, class/method badge, detail line,
 * an optional control on the right (`trailing`) and action buttons below.
 */
function TokenRow({
  token,
  detail,
  trailing,
  actions,
  onLongPress,
}: {
  token: ConsoleToken;
  detail: string;
  trailing?: ReactNode;
  actions?: ReactNode;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const tag =
    token.cls === "triage"
      ? "Triage"
      : token.cls === "priority"
        ? "Priority"
        : METHOD_LABELS[token.method];
  return (
    <Pressable
      onLongPress={onLongPress}
      disabled={!onLongPress}
      accessibilityLabel={`#${token.label}, ${tag}, ${detail}`}
      style={[
        styles.row,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <View style={styles.rowTop}>
        <View
          style={[styles.labelPill, { backgroundColor: theme.primarySoft }]}
        >
          <ThemedText type="heading" themeColor="primary">
            #{token.label}
          </ThemedText>
        </View>
        <View style={styles.flex}>
          <Badge
            label={token.paid ? `${tag} · Paid` : tag}
            tone={token.cls === "triage" ? "danger" : "neutral"}
          />
          <ThemedText type="small" themeColor="inkMuted">
            {detail}
          </ThemedText>
        </View>
        {trailing}
      </View>
      {actions ? <View style={styles.rowActions}>{actions}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centreCard: { alignItems: "center" },
  centreText: { textAlign: "center" },
  stretch: { alignSelf: "stretch" },
  next: { minHeight: 72 },
  undo: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.button,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    minHeight: 52,
  },
  undoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    minHeight: 44,
    paddingHorizontal: Spacing.twoHalf,
  },
  dim: { opacity: 0.6 },
  flex: { flex: 1, gap: Spacing.one },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.twoHalf },
  cell: { flexBasis: "47%", flexGrow: 1 },
  row: {
    gap: Spacing.two,
    padding: Spacing.twoHalf,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
  },
  rowActions: { flexDirection: "row", gap: Spacing.two },
  labelPill: {
    minWidth: 64,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.button,
    alignItems: "center",
  },
  rowButton: { flex: 1, minHeight: 44, paddingHorizontal: Spacing.twoHalf },
  menuButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});

import {
  AUTO_CLOSE_WARNING_MS,
  type ConsoleState,
  type ConsoleToken,
  closeSummary,
  lastCalledLabel,
  waitText,
} from "@qpeer/shared";
import { useQueryClient } from "@tanstack/react-query";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  ChoiceChips,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  HeaderButton,
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
import { useOffline } from "@/lib/network";
import {
  formatClock,
  formatCountdown,
  formatDateTime,
  liveStatusLook,
  METHOD_LABELS,
  useNow,
} from "@/lib/queue-format";
import { useStored } from "@/lib/storage";
import { showErrorToast, showToast } from "@/lib/toast";
import { StaffRejoinCard } from "@/screens/staff-rejoin";

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
  // C1: the chosen queue is remembered across restarts.
  const remembered = useStored("consoleQueue");
  const offline = useOffline();
  const selected = remembered.value ?? null;
  const current = queues.find((q) => q.id === selected) ?? queues[0] ?? null;

  if (list.isPending) {
    return (
      <Screen bottomInset={false}>
        {offline ? (
          <EmptyState
            icon="cloud_off"
            title="The console needs internet"
            message="Your queues show as soon as you're online."
          />
        ) : (
          <LoadingState label="Loading your queues…" />
        )}
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
            onChange={(id) => remembered.set(id)}
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
  const router = useRouter();
  const offline = useOffline();
  const queryClient = useQueryClient();
  const consoleQ = useConsole(queue.id);
  const command = useConsoleCommand(queue.id);
  const [counter, setCounter] = useState(1);
  // R2: the "Rejoin for customer" form: closed, open blank, or for one row.
  const [rejoinFor, setRejoinFor] = useState<RejoinTarget>(null);
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
  // Ticks every second for undo/grace countdowns, else every 30 s (the
  // auto-close warning only needs minutes).
  const fast = Boolean(undoActive || (state && state.grace.length > 0));
  const now = useNow(true, fast ? 1000 : 30_000);

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

  // B13: offline, the console keeps the last state, greyed, and pauses actions.
  const busy = command.isPending || offline;
  const run = async (cmd: ConsoleCommand, errorTitle: string) => {
    if (command.isPending || offline) return false;
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

  // `now` is server-corrected (B9), so the undo window matches the server's.
  const undoLeft =
    state.undoUntil !== null ? Math.max(0, state.undoUntil - now) : 0;
  const showUndo = undoLeft > 0 && state.status !== "closed";

  return (
    <View style={styles.fill}>
      <Screen
        bottomInset={false}
        refreshing={consoleQ.isRefetching}
        onRefresh={() => {
          void consoleQ.refetch();
          refreshList();
        }}
        // B10: compact spacing for small screens; room under the content
        // for the floating Undo bar so it never hides the last row.
        contentStyle={[
          styles.compact,
          showUndo && { paddingBottom: UNDO_BAR_SPACE },
        ]}
      >
        {picker}
        {offline ? (
          <StatusBanner
            tone="paused"
            title="Offline — actions paused"
            detail={`Showing the queue as of ${formatClock(state.updatedAt)}. Actions come back when you're online.`}
          />
        ) : null}
        <View style={offline ? styles.greyed : undefined}>
          <ConsoleView
            state={state}
            queue={queue}
            live={live === "live"}
            busy={busy}
            now={now}
            counter={Math.min(counter, state.counters)}
            setCounter={setCounter}
            run={run}
            onVerify={() =>
              // A plain string: the typed-routes file (.expo/types, made by
              // `expo start`) may not list this new route yet on a checkout.
              router.push(
                `/queue/${encodeURIComponent(queue.id)}/verify` as Href,
              )
            }
            rejoinFor={rejoinFor}
            setRejoinFor={setRejoinFor}
          />
        </View>
      </Screen>
      {showUndo ? (
        <UndoBar
          // The token the last NEXT called (P1, T2…), even after a No-show
          // emptied "Now serving".
          label={lastCalledLabel(state) ?? state.nowServing}
          undoLeft={undoLeft}
          busy={busy}
          onUndo={() =>
            void run({ kind: "queue", action: "undo-next" }, "Could not undo")
          }
        />
      ) : null}
    </View>
  );
}

/** Height kept free under the scroll content while the Undo bar floats. */
const UNDO_BAR_HEIGHT = 52;
const UNDO_BAR_SPACE = UNDO_BAR_HEIGHT + Spacing.twoHalf * 2;

/**
 * B10: the Undo bar floats just above the tab bar, so it is visible after
 * NEXT on any screen height, whatever the scroll position.
 */
function UndoBar({
  label,
  undoLeft,
  busy,
  onUndo,
}: {
  label: string | null;
  undoLeft: number;
  busy: boolean;
  onUndo: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.undo,
        styles.undoFloating,
        {
          backgroundColor: theme.header,
          shadowColor: theme.shadow,
          left: insets.left + Spacing.three,
          right: insets.right + Spacing.three,
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <ThemedText type="body" themeColor="onPrimary" style={styles.flex}>
        {label ? `Called #${label}` : "Called next"} · undo in{" "}
        {formatCountdown(undoLeft)}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo the last Next"
        disabled={busy}
        hitSlop={8}
        onPress={onUndo}
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
  );
}

/** Which "Rejoin for customer" form is open (a blank one, or for a row). */
type RejoinTarget = { token: ConsoleToken | null } | null;

/**
 * "Priority due in 2 calls" (C1 credit counter): a priority holder is
 * called once `credits ≥ N`; each regular call adds one credit.
 */
function priorityDueText(state: ConsoleState): string | null {
  const p = state.priority;
  if (!p?.enabled) return null;
  const n = Math.max(1, p.perRegular);
  const lane = `Priority lane on · 1 in ${n}`;
  const waiting = state.waiting.filter(
    (t) => (t.lane ?? t.cls) === "priority",
  ).length;
  const sold =
    p.dailyCap !== null
      ? ` · ${p.soldToday}/${p.dailyCap} sold today`
      : p.soldToday > 0
        ? ` · ${p.soldToday} sold today`
        : "";
  if (waiting === 0) return `${lane} · nobody in it${sold}`;
  const left = Math.max(0, n - Math.min(p.credits, n));
  return left === 0
    ? `${lane} · priority due now${sold}`
    : `${lane} · priority due in ${left} ${left === 1 ? "call" : "calls"}${sold}`;
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
  onVerify,
  rejoinFor,
  setRejoinFor,
}: {
  state: ConsoleState;
  queue: ConsoleQueue;
  live: boolean;
  busy: boolean;
  now: number;
  counter: number;
  setCounter: (c: number) => void;
  run: (cmd: ConsoleCommand, errorTitle: string) => Promise<boolean>;
  /** C3: open the ticket scanner. */
  onVerify: () => void;
  rejoinFor: RejoinTarget;
  setRejoinFor: (t: RejoinTarget) => void;
}) {
  const missed = state.missed ?? [];
  const dueText = priorityDueText(state);
  const status = liveStatusLook(state.status);
  const closed = state.status === "closed";
  // B20: warn 15 min before the auto-close; "Keep open" adds an hour.
  const autoCloseAt = state.autoCloseAt ?? null;
  const closingSoon =
    !closed &&
    autoCloseAt !== null &&
    now >= autoCloseAt - AUTO_CLOSE_WARNING_MS;
  const carried = state.waiting.filter((t) => t.carriedOver);
  const paused = state.status === "paused";
  const multi = state.counters > 1;
  const atCounter =
    state.serving.find((s) => s.counter === counter) ??
    (multi ? undefined : state.serving[0]);
  const canNext =
    !closed && !paused && (state.counts.waiting > 0 || atCounter !== undefined);

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
    // C4: waiting tickets still valid after now carry over instead of ending.
    // Step 4: paid tickets that end are refunded in full automatically.
    const c = closeSummary(state, now);
    const left = c.ending;
    const keepText =
      c.kept > 0
        ? ` ${c.kept} ${c.kept === 1 ? "ticket is" : "tickets are"} valid beyond today and will be served first next time.`
        : "";
    const paidText =
      c.paidRefunded > 0
        ? ` ${c.paidRefunded} of them ${c.paidRefunded === 1 ? "is a paid ticket and is" : "are paid tickets and are"} refunded in full automatically.`
        : "";
    const bookedText =
      c.booked > 0
        ? ` ${c.booked} Priority ${c.booked === 1 ? "Pass" : "Passes"} not checked in yet ${c.booked === 1 ? "stays" : "stay"} valid.`
        : "";
    const ok = await ConfirmDialog.show({
      title: "Close for the day?",
      message:
        left > 0
          ? `${left} ${left === 1 ? "ticket is" : "tickets are"} still active. They will expire and those customers are told the queue closed.${paidText} Numbers start again at 1 when you open next time.${keepText}${bookedText}`
          : `Nobody can join until you open the queue again. Numbers start again at 1 next time.${keepText}${bookedText}`,
      confirmLabel: "Close queue",
    });
    if (ok) await run({ kind: "queue", action: "close" }, "Could not close");
  };

  const waitingMenu = (t: ConsoleToken) => {
    Alert.alert(`#${t.label}`, "Waiting", [
      {
        text: "Skip (move back a few places)",
        onPress: () =>
          void run(
            { kind: "token", action: "skip", tokenId: t.id },
            "Could not skip",
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // B10: Served / No-show sit right under Now Serving.
  const calledSection =
    state.serving.length > 0 ? (
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
    ) : null;

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

      {closingSoon && autoCloseAt !== null ? (
        <StatusBanner
          tone="paused"
          title={
            now >= autoCloseAt
              ? "Closing now"
              : `Closes by itself at ${formatClock(autoCloseAt)}`
          }
          detail="After the day's opening hours the queue closes automatically. Remaining tickets end as on Close."
          right={
            <HeaderButton
              title="Keep open"
              disabled={busy}
              onPress={() =>
                void run(
                  { kind: "queue", action: "keep-open" },
                  "Could not keep the queue open",
                ).then((ok) => {
                  if (ok) {
                    showToast({
                      title: "Kept open for another hour",
                      tone: "success",
                    });
                  }
                })
              }
            />
          }
        />
      ) : null}

      {closed ? (
        <>
          <Card style={styles.centreCard}>
            <ThemedText type="heading">{queue.name} is closed</ThemedText>
            <ThemedText
              type="small"
              themeColor="inkMuted"
              style={styles.centreText}
            >
              {carried.length > 0
                ? `Open it to start a new session. ${carried.length} ${carried.length === 1 ? "ticket is" : "tickets are"} still valid and will be served first.`
                : "Open it to start today's session. Customers can then scan the QR code and join."}
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
          {calledSection}
          {carried.length > 0 ? (
            <>
              <SectionHeader
                title={`Kept for next session (${carried.length})`}
              />
              {carried.slice(0, MAX_WAITING_ROWS).map((t) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  detail={`joined ${formatDateTime(t.joinedAt)}${t.expiresAt ? ` · valid until ${formatDateTime(t.expiresAt)}` : ""}`}
                />
              ))}
            </>
          ) : null}
        </>
      ) : (
        <>
          {/* B10: one compact row, so Called and NEXT fit above the fold. */}
          <Card style={styles.servingCard}>
            <View style={styles.servingRow}>
              <View style={styles.flex}>
                <ThemedText type="heading">Now Serving</ThemedText>
                {multi && state.serving.length > 0 ? (
                  <ThemedText type="small" themeColor="inkMuted">
                    {state.serving
                      .map((s) => `Counter ${s.counter ?? "?"}: #${s.label}`)
                      .join(" · ")}
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText
                type="display"
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {state.nowServing ? `#${state.nowServing}` : "—"}
              </ThemedText>
            </View>
          </Card>

          {calledSection}

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
          {dueText ? (
            <View style={styles.dueRow}>
              <Icon name="bolt" size={18} color="brand" />
              <ThemedText
                type="small"
                themeColor="inkMuted"
                style={styles.flex}
                accessibilityLiveRegion="polite"
              >
                {dueText}
              </ThemedText>
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

      {/* QUE-22/29: missed tickets are out of the order until they rejoin. */}
      {missed.length > 0 ? (
        <>
          <SectionHeader title={`Missed (${missed.length})`} />
          {missed.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              detail={`missed ${t.missedAt ? formatClock(t.missedAt) : ""}${t.rejoined ? " · already rejoined once" : " · can rejoin once"}`}
              actions={
                t.rejoined ? undefined : (
                  <Button
                    title="Rejoin for customer"
                    icon="restart_alt"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setRejoinFor({ token: t })}
                    style={styles.rowButton}
                  />
                )
              }
            />
          ))}
        </>
      ) : null}
      {rejoinFor ? (
        <StaffRejoinCard
          key={rejoinFor.token?.id ?? "blank"}
          queueId={queue.id}
          prefill={rejoinFor.token}
          onDone={() => setRejoinFor(null)}
          onScan={onVerify}
        />
      ) : !closed ? (
        <Button
          title="Rejoin for customer"
          icon="restart_alt"
          variant="secondary"
          disabled={busy}
          onPress={() => setRejoinFor({ token: null })}
          accessibilityLabel="Rejoin a missed customer by number and check code"
        />
      ) : null}

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
      {(state.counts.booked ?? 0) > 0 ? (
        <ThemedText type="small" themeColor="inkMuted">
          {`${state.counts.booked} Priority ${state.counts.booked === 1 ? "Pass is" : "Passes are"} paid but not checked in yet (not in the line).`}
        </ThemedText>
      ) : null}
      {!closed ? (
        <ThemedText type="small" themeColor="inkMuted">
          Someone joining now:{" "}
          {waitText(
            {
              waiting: state.counts.waiting,
              inService: state.counts.inService,
              waitLowMs: state.eta.waitLowMs,
              waitHighMs: state.eta.waitHighMs,
              updatedAt: state.updatedAt,
            },
            now,
          ) ?? "wait not known yet"}
          {state.eta.coldStart ? " (estimate from your settings)" : ""}.
        </ThemedText>
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
                detail={`${t.position !== null ? `${t.position}. ` : ""}joined ${t.carriedOver ? formatDateTime(t.joinedAt) : formatClock(t.joinedAt)}`}
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

      {/* C3: works offline (signature check on the phone). */}
      <Button
        title="Verify a ticket"
        icon="qr_code_scanner"
        variant="secondary"
        onPress={onVerify}
        accessibilityLabel="Verify a customer's ticket code"
      />
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
  // The lane it is called from: passes (P numbers) and upgraded tickets
  // (same number) are in the priority lane.
  const lane = token.lane ?? token.cls;
  const base =
    lane === "triage"
      ? "Triage"
      : lane === "priority"
        ? token.series === "P"
          ? "Priority Pass"
          : "Priority · upgraded"
        : METHOD_LABELS[token.method];
  // C4: carried over from an earlier session (same number, served first).
  const tag = token.carriedOver ? `${base} · Kept` : base;
  // C4 (2026-10-18): the holder's full name, online console only.
  const line = token.holderName ? `${token.holderName} · ${detail}` : detail;
  return (
    <Pressable
      onLongPress={onLongPress}
      disabled={!onLongPress}
      accessibilityLabel={`#${token.label}, ${tag}, ${line}`}
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
            tone={
              lane === "triage"
                ? "danger"
                : lane === "priority"
                  ? "success"
                  : "neutral"
            }
          />
          <ThemedText type="small" themeColor="inkMuted">
            {line}
          </ThemedText>
        </View>
        {trailing}
      </View>
      {actions ? <View style={styles.rowActions}>{actions}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  greyed: { opacity: 0.5, gap: Spacing.twoHalf },
  compact: { paddingTop: Spacing.twoHalf, gap: Spacing.twoHalf },
  centreCard: { alignItems: "center" },
  centreText: { textAlign: "center" },
  stretch: { alignSelf: "stretch" },
  servingCard: { paddingVertical: Spacing.two },
  servingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  next: { minHeight: 72 },
  undo: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.button,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    minHeight: UNDO_BAR_HEIGHT,
  },
  undoFloating: {
    position: "absolute",
    bottom: Spacing.twoHalf,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
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
  dueRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
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

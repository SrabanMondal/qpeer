import {
  ConsoleState,
  type ConsoleToken,
  type StaffRejoinBody,
  TriageResponse,
} from "@qpeer/shared";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useAuth } from "@/lib/auth";

const enc = encodeURIComponent;

/** GET /v1/queues/:id/console (staff). */
export function getConsole(queueId: string) {
  return apiFetch(`/v1/queues/${enc(queueId)}/console`, ConsoleState);
}

/** Queue-level console actions (BIZ-13, QUE-05, QUE-07, QUE-09, QUE-12). */
export type QueueAction =
  | "open"
  | "close"
  | "pause"
  | "resume"
  | "next"
  | "undo-next"
  /** B20: push the auto-close 1 h later. */
  | "keep-open";

/** Token-level console actions (QUE-06, QUE-08). */
export type TokenAction = "skip" | "no-show" | "admit" | "served";

export type ConsoleCommand =
  | { kind: "queue"; action: QueueAction; counter?: number }
  | { kind: "token"; action: TokenAction; tokenId: string }
  | { kind: "triage" };

/** Runs one console command and returns the new console state. */
export async function runConsoleCommand(
  queueId: string,
  cmd: ConsoleCommand,
): Promise<ConsoleState> {
  const base = `/v1/queues/${enc(queueId)}`;
  if (cmd.kind === "triage") {
    const r = await apiFetch(`${base}/triage`, TriageResponse, {
      method: "POST",
    });
    return r.console;
  }
  if (cmd.kind === "token") {
    return apiFetch(
      `${base}/tokens/${enc(cmd.tokenId)}/${cmd.action}`,
      ConsoleState,
      { method: "POST" },
    );
  }
  return apiFetch(`${base}/${cmd.action}`, ConsoleState, {
    method: "POST",
    body:
      cmd.action === "next" && cmd.counter !== undefined
        ? { counter: cmd.counter }
        : undefined,
  });
}

/**
 * Writes a console state into the cache unless the cache already holds a
 * newer one (a socket push can overtake an HTTP answer and vice versa).
 */
export function storeConsole(
  queryClient: QueryClient,
  uid: string | null,
  state: ConsoleState,
) {
  queryClient.setQueryData<ConsoleState>(
    queryKeys.console(uid, state.queueId),
    (old) =>
      old && old.updatedAt > state.updatedAt ? old : keepNames(old, state),
  );
}

/**
 * C4: holder names come only with `GET /console`, never on socket messages;
 * keep the names already known for the same tokens so they don't flicker
 * away on the next live update.
 */
function keepNames(
  old: ConsoleState | undefined,
  next: ConsoleState,
): ConsoleState {
  if (!old) return next;
  const names = new Map<string, string>();
  for (const t of [
    ...old.serving,
    ...old.waiting,
    ...old.grace,
    ...(old.missed ?? []),
  ]) {
    if (t.holderName) names.set(t.id, t.holderName);
  }
  if (names.size === 0) return next;
  const fill = (list: ConsoleToken[]) =>
    list.map((t) =>
      t.holderName == null && names.has(t.id)
        ? { ...t, holderName: names.get(t.id) }
        : t,
    );
  return {
    ...next,
    serving: fill(next.serving),
    waiting: fill(next.waiting),
    grace: fill(next.grace),
    missed: next.missed ? fill(next.missed) : next.missed,
  };
}

export function useConsole(queueId: string | null) {
  const uid = useAuth().user?.uid ?? null;
  const queryClient = useQueryClient();
  const id = queueId ?? "";
  return useQuery({
    queryKey: queryKeys.console(uid, id),
    queryFn: async () => {
      const fresh = await getConsole(id);
      const old = queryClient.getQueryData<ConsoleState>(
        queryKeys.console(uid, id),
      );
      return old && old.updatedAt > fresh.updatedAt ? old : fresh;
    },
    enabled: uid !== null && id.length > 0,
    staleTime: 5_000,
  });
}

/**
 * POST /v1/queues/:id/rejoin-for-customer (R2, QUE-29): number + check code
 * or a scanned signed ticket. The answer has the same shape as triage's
 * (`{ token, console }`).
 */
export function staffRejoin(queueId: string, body: StaffRejoinBody) {
  return apiFetch(
    `/v1/queues/${enc(queueId)}/rejoin-for-customer`,
    TriageResponse,
    { method: "POST", body },
  );
}

export function useStaffRejoin(queueId: string) {
  const uid = useAuth().user?.uid ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StaffRejoinBody) => staffRejoin(queueId, body),
    onSuccess: (r) => storeConsole(queryClient, uid, r.console),
  });
}

export function useConsoleCommand(queueId: string) {
  const uid = useAuth().user?.uid ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cmd: ConsoleCommand) => runConsoleCommand(queueId, cmd),
    onSuccess: (state, cmd) => {
      storeConsole(queryClient, uid, state);
      // Open/close/pause change the live summary in business views too.
      if (cmd.kind === "queue" && cmd.action !== "next") {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.myBusinesses(uid),
        });
      }
    },
  });
}

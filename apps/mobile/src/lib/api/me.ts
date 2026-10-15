import { MeResponse, type UpdateMeBody } from "@qpeer/shared";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { providerOf, useAuth } from "@/lib/auth";

/** GET /v1/me */
export function getMe(): Promise<MeResponse> {
  return apiFetch("/v1/me", MeResponse);
}

/** PATCH /v1/me (IDN-06 display name, IDN-08 preferred mode). */
export function updateMe(body: UpdateMeBody): Promise<MeResponse> {
  return apiFetch("/v1/me", MeResponse, { method: "PATCH", body });
}

/** GET /v1/me for the signed-in Firebase user. */
export function useMe() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  return useQuery({
    queryKey: queryKeys.me(uid, providerOf(user)),
    queryFn: getMe,
    enabled: uid !== null,
    // Keep showing the last answer while the key changes (e.g. right after
    // linking Google/phone), so the tabs never fall back to a loading screen.
    placeholderData: keepPreviousData,
  });
}

export function useUpdateMe() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMe,
    onSuccess: (data) => {
      queryClient.setQueriesData<MeResponse>(
        { queryKey: queryKeys.meAll(uid) },
        data,
      );
      // A /me request started before the PATCH (e.g. right after linking) may
      // still be in flight; refetch so it cannot put old values back. Also
      // covers a sign-in that switched to another account (new uid).
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from "react-native";

import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { ApiError, useMe } from "@/lib/api";
import { authErrorMessage, providerOf, useAuth } from "@/lib/auth";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small" selectable style={styles.rowValue}>
        {value}
      </ThemedText>
    </ThemedView>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, initializing, error: authError, signOut } = useAuth();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (e) {
      Alert.alert("Sign out failed", authErrorMessage(e));
    } finally {
      setSigningOut(false);
    }
  };

  const meError = me.error;

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="smallBold">Firebase</ThemedText>
        {initializing ? (
          <ActivityIndicator />
        ) : authError ? (
          <ThemedText style={styles.error}>
            Could not sign in: {authError}
          </ThemedText>
        ) : user ? (
          <>
            <Row label="uid" value={`${user.uid.slice(0, 8)}…`} />
            <Row label="provider" value={providerOf(user)} />
            <Row label="anonymous" value={user.isAnonymous ? "yes" : "no"} />
          </>
        ) : (
          <ThemedText type="small">Signing in…</ThemedText>
        )}

        <ThemedText type="smallBold" style={styles.section}>
          API /v1/me
        </ThemedText>
        {me.isPending && me.fetchStatus === "fetching" ? (
          <ActivityIndicator />
        ) : meError ? (
          <ThemedView type="backgroundElement" style={styles.errorBox}>
            <ThemedText style={styles.error}>{meError.message}</ThemedText>
            {meError instanceof ApiError ? (
              <ThemedText type="small" selectable>
                status {meError.status} · {meError.code}
                {meError.requestId ? `\nrequest ID: ${meError.requestId}` : ""}
              </ThemedText>
            ) : null}
            <Button
              title="Retry"
              variant="secondary"
              onPress={() => me.refetch()}
              loading={me.isFetching}
            />
          </ThemedView>
        ) : me.data ? (
          <>
            <Row label="user id" value={me.data.user.id} />
            <Row
              label="isAnonymous"
              value={me.data.user.isAnonymous ? "true" : "false"}
            />
            <Row label="displayName" value={me.data.user.displayName ?? "—"} />
            <Row label="email" value={me.data.user.email ?? "—"} />
            <Row label="phone" value={me.data.user.phone ?? "—"} />
            <Button
              title="Refresh"
              variant="secondary"
              onPress={() => me.refetch()}
              loading={me.isFetching}
            />
          </>
        ) : (
          <ThemedText type="small">Waiting for sign-in…</ThemedText>
        )}

        <ThemedView style={styles.actions}>
          {user?.isAnonymous ? (
            <Button title="Sign in" onPress={() => router.push("/sign-in")} />
          ) : null}
          {user && !user.isAnonymous ? (
            <Button
              title="Sign out"
              variant="secondary"
              onPress={onSignOut}
              loading={signingOut}
            />
          ) : null}
          <Button
            title="Map check"
            variant="secondary"
            onPress={() => router.push("/map-check")}
          />
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  section: { marginTop: Spacing.three },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 8,
  },
  rowValue: { flexShrink: 1, textAlign: "right" },
  errorBox: { padding: Spacing.three, borderRadius: 8, gap: Spacing.two },
  error: { color: "#D93025" },
  actions: { marginTop: Spacing.four, gap: Spacing.two },
});

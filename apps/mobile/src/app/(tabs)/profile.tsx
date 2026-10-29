import { DisplayName } from "@qpeer/shared";
import { type Href, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  InfoRow,
  ListItem,
  LoadingState,
  ModeSwitch,
  Screen,
  SectionHeader,
  TextField,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useDevMapSeed, useUpdateMe } from "@/lib/api";
import { authErrorMessage, providerOf, useAuth } from "@/lib/auth";
import { errorText } from "@/lib/error-messages";
import { type FieldErrors, useFieldErrors } from "@/lib/form";
import { goHome, useAppMode, useModeToggle } from "@/lib/mode";
import { showErrorToast, showToast } from "@/lib/toast";
import { useBackPressGuard } from "@/lib/unsaved-changes";

function validateDisplayName(name: string): FieldErrors {
  return DisplayName.safeParse(name).success
    ? {}
    : { name: "Enter a name of 1 to 60 characters." };
}

const PROVIDER_LABELS: Record<string, string> = {
  anonymous: "Guest (not signed in)",
  "google.com": "Google",
  phone: "Phone",
};

function signInMethod(provider: string): string {
  return provider
    .split(", ")
    .map((p) => PROVIDER_LABELS[p] ?? p)
    .join(", ");
}

/** IDN-06 profile, IDN-08 mode switch, sign in/out, developer tools. */
export default function ProfileTab() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { me } = useAppMode();
  const { mode, registered, switching, change } = useModeToggle();
  const updateMe = useUpdateMe();

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const nameForm = useFieldErrors(validateDisplayName);
  const [signingOut, setSigningOut] = useState(false);

  const profile = me.data?.user;
  const nameDirty = editingName && name !== (profile?.displayName ?? "");
  const closeNameEditor = useCallback(() => setEditingName(false), []);
  // B8: Android back while the name has unsaved edits asks first.
  useBackPressGuard(nameDirty, closeNameEditor);

  const startEditName = () => {
    setName(profile?.displayName ?? "");
    nameForm.reset();
    setEditingName(true);
  };

  const saveName = async () => {
    if (!nameForm.validateAll(name)) return;
    try {
      await updateMe.mutateAsync({ displayName: name.trim() });
      setEditingName(false);
    } catch (e) {
      nameForm.showErrors({ name: errorText(e) });
    }
  };

  const onSignOut = async () => {
    const ok = await ConfirmDialog.show({
      title: "Sign out?",
      message:
        "You will continue as a guest. Your businesses stay in your account.",
      confirmLabel: "Sign out",
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await signOut();
      goHome("customer");
    } catch (e) {
      Alert.alert("Sign out failed", authErrorMessage(e));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Screen
      bottomInset={false}
      refreshing={me.isRefetching}
      onRefresh={() => {
        void me.refetch();
      }}
    >
      <SectionHeader title="Mode" />
      <Card>
        <ModeSwitch
          mode={mode}
          onChange={(m) => {
            void change(m);
          }}
          disabled={switching}
        />
        <ThemedText type="small" themeColor="inkMuted">
          {registered
            ? "Business mode is for owners: businesses, queues and QR codes. Customer mode is for joining queues."
            : "Business mode needs an account. Turning it on asks you to sign in first."}
        </ThemedText>
        {switching ? <LoadingState label="Switching…" /> : null}
      </Card>

      <SectionHeader title="You" />
      {me.isError && !profile ? (
        <ErrorState
          title="Could not load your profile"
          error={me.error}
          onRetry={() => me.refetch()}
          retrying={me.isFetching}
        />
      ) : !profile ? (
        <LoadingState />
      ) : (
        <Card>
          {editingName ? (
            <View style={styles.gap}>
              <TextField
                label="Display name"
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  nameForm.revalidate(v, "name");
                }}
                error={nameForm.errors.name}
                autoFocus
                maxLength={60}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={saveName}
              />
              <Button
                title="Save name"
                onPress={saveName}
                loading={updateMe.isPending}
              />
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setEditingName(false)}
                disabled={updateMe.isPending}
              />
            </View>
          ) : (
            <>
              <InfoRow label="Name" value={profile.displayName ?? "Not set"} />
              <Button
                title="Edit name"
                icon="edit"
                variant="secondary"
                onPress={startEditName}
              />
            </>
          )}
          <InfoRow label="Email" value={profile.email ?? "—"} />
          <InfoRow label="Phone" value={profile.phone ?? "—"} />
          <InfoRow
            label="Signed in with"
            value={signInMethod(providerOf(user))}
          />
          <InfoRow label="User ID" value={profile.id} selectable />
        </Card>
      )}

      <SectionHeader title="Payments" />
      <ListItem
        icon="receipt_long"
        title="My payments"
        subtitle={
          user?.isAnonymous
            ? "Sign in to reserve or buy a Priority Pass"
            : "Reservations, passes, refunds"
        }
        onPress={() => router.push("/payments" as Href)}
      />

      <SectionHeader title="Account" />
      {user?.isAnonymous ? (
        <Button
          title="Sign in"
          icon="login"
          onPress={() => router.push("/sign-in")}
        />
      ) : user ? (
        <Button
          title="Sign out"
          icon="logout"
          variant="danger-soft"
          onPress={onSignOut}
          loading={signingOut}
        />
      ) : null}

      <SectionHeader title="Developer" />
      <ListItem
        icon="map"
        title="Map check"
        subtitle="Mapbox test map on Jammu"
        onPress={() => router.push("/map-check")}
      />
      {__DEV__ ? <DemoMapTools /> : null}
    </Screen>
  );
}

/**
 * Dev builds only: add/remove the 8 "Demo · " businesses around Jammu on the
 * dev Worker (POST /v1/dev/seed-map, /unseed-map). Needs a signed-in account.
 */
function DemoMapTools() {
  const { seed, unseed } = useDevMapSeed();
  const busy = seed.isPending || unseed.isPending;

  const onSeed = async () => {
    const ok = await ConfirmDialog.show({
      title: "Add demo businesses?",
      message:
        "Adds 8 “Demo · ” businesses with open queues around Jammu on the dev server. Everyone using the dev server sees them.",
      confirmLabel: "Add",
      destructive: false,
    });
    if (!ok) return;
    try {
      const r = await seed.mutateAsync();
      showToast({
        title: "Demo businesses added",
        message: `${r.businesses} businesses, ${r.queues} queues (${r.created} new).`,
        tone: "success",
      });
    } catch (e) {
      showErrorToast("Could not add demo businesses", e);
    }
  };

  const onUnseed = async () => {
    const ok = await ConfirmDialog.show({
      title: "Remove demo businesses?",
      message:
        "Deletes every “Demo · ” business, its queues and tickets from the dev server.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      const r = await unseed.mutateAsync();
      showToast({
        title: "Demo businesses removed",
        message: `${r.businesses} removed.`,
        tone: "success",
      });
    } catch (e) {
      showErrorToast("Could not remove demo businesses", e);
    }
  };

  return (
    <>
      <ListItem
        icon="add_location_alt"
        title="Add demo businesses"
        subtitle={seed.isPending ? "Adding…" : "8 demo places around Jammu"}
        onPress={busy ? undefined : () => void onSeed()}
      />
      <ListItem
        icon="wrong_location"
        title="Remove demo businesses"
        subtitle={unseed.isPending ? "Removing…" : "Deletes the demo places"}
        onPress={busy ? undefined : () => void onUnseed()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.two },
});

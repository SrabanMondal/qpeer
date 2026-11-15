import { DisplayName } from "@qpeer/shared";
import { type Href, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Icon,
  InfoRow,
  ListItem,
  LoadingState,
  ModeSwitch,
  Screen,
  SectionHeader,
  TextField,
} from "@/components/ui";
import { Radius, RIPPLE_ALPHA, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useDevMapSeed, useUpdateMe } from "@/lib/api";
import { authErrorMessage, providerOf, useAuth } from "@/lib/auth";
import { errorText } from "@/lib/error-messages";
import { type FieldErrors, useFieldErrors } from "@/lib/form";
import { goHome, useAppMode, useModeToggle } from "@/lib/mode";
import { openBatterySettings } from "@/lib/push";
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

/**
 * IDN-06 profile, IDN-08 mode switch, sign in/out. Job: switch mode, check
 * or change the name, reach payments, sign in or out. Developer tools only
 * in dev builds.
 */
export default function ProfileTab() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { me } = useAppMode();
  const { mode, registered, switching, change } = useModeToggle();
  const updateMe = useUpdateMe();
  const theme = useTheme();

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
      showToast({
        title: "Sign out failed",
        message: authErrorMessage(e),
        tone: "danger",
      });
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
        <View style={styles.switchRow}>
          <ModeSwitch
            mode={mode}
            onChange={(m) => {
              void change(m);
            }}
            disabled={switching}
          />
          {switching ? (
            <ActivityIndicator
              color={theme.primary}
              accessibilityLabel="Switching mode"
            />
          ) : null}
        </View>
        {registered ? null : (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            Business mode needs an account. Turning it on asks you to sign in
            first.
          </ThemedText>
        )}
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
              <View style={styles.editActions}>
                <Button
                  title="Cancel"
                  variant="text"
                  onPress={() => setEditingName(false)}
                  disabled={updateMe.isPending}
                />
                <Button
                  title="Save name"
                  onPress={saveName}
                  loading={updateMe.isPending}
                />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={startEditName}
              accessibilityRole="button"
              accessibilityLabel={`Name: ${profile.displayName ?? "not set"}. Edit name`}
              android_ripple={{ color: theme.onSurface, alpha: RIPPLE_ALPHA }}
              style={styles.nameRow}
            >
              <View style={styles.flex}>
                <InfoRow
                  label="Name"
                  value={profile.displayName ?? "Not set"}
                />
              </View>
              <Icon name="edit" color="onSurfaceVariant" />
            </Pressable>
          )}
          {profile.email ? (
            <InfoRow label="Email" value={profile.email} />
          ) : null}
          {profile.phone ? (
            <InfoRow label="Phone" value={profile.phone} />
          ) : null}
          <InfoRow
            label="Signed in with"
            value={signInMethod(providerOf(user))}
          />
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

      {Platform.OS === "android" ? (
        <>
          <SectionHeader title="Alerts" />
          <ListItem
            icon="battery_saver"
            title="Alerts and battery"
            subtitle="Let Qpeer run in the background so alerts arrive on time"
            onPress={() => void openBatterySettings()}
          />
        </>
      ) : null}

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
          variant="danger-tonal"
          onPress={onSignOut}
          loading={signingOut}
        />
      ) : null}

      {profile ? (
        <>
          <SectionHeader title="About this account" />
          <Card tone="surfaceContainerLow">
            <InfoRow label="User ID" value={profile.id} selectable />
          </Card>
        </>
      ) : null}

      {__DEV__ ? (
        <>
          <SectionHeader title="Developer" />
          <ListItem
            icon="map"
            title="Map check"
            subtitle="Mapbox test map on Jammu"
            onPress={() => router.push("/map-check")}
          />
          <DemoMapTools />
        </>
      ) : null}
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
  switchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.two,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 48,
    marginHorizontal: -Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
    overflow: "hidden",
  },
  flex: { flex: 1 },
});

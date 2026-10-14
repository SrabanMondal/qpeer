import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, TextInput } from "react-native";

import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { authErrorMessage, googleSignInConfigured, useAuth } from "@/lib/auth";

type Busy = "google" | "send" | "confirm" | null;

export default function SignInScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { signInWithGoogle, startPhoneSignIn, confirmPhoneCode } = useAuth();

  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const onGoogle = async () => {
    setGoogleError(null);
    setBusy("google");
    try {
      if (await signInWithGoogle()) done();
    } catch (e) {
      setGoogleError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onSendCode = async () => {
    setPhoneError(null);
    setBusy("send");
    try {
      const autoVerified = await startPhoneSignIn(phone.replace(/[\s-]/g, ""));
      if (autoVerified) {
        done();
        return;
      }
      setCodeSent(true);
      setCode("");
    } catch (e) {
      setPhoneError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onConfirm = async () => {
    setPhoneError(null);
    setBusy("confirm");
    try {
      await confirmPhoneCode(code);
      done();
    } catch (e) {
      setPhoneError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.backgroundSelected },
  ];

  return (
    <ThemedView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText type="smallBold">Google</ThemedText>
        {googleSignInConfigured ? (
          <Button
            title="Continue with Google"
            onPress={onGoogle}
            loading={busy === "google"}
            disabled={busy !== null}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Google sign-in is not configured yet.
          </ThemedText>
        )}
        {googleError ? (
          <ThemedText type="small" style={styles.error}>
            {googleError}
          </ThemedText>
        ) : null}

        <ThemedText type="smallBold" style={styles.section}>
          Phone
        </ThemedText>
        <TextInput
          style={inputStyle}
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98765 43210"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          autoComplete="tel"
          editable={!codeSent && busy === null}
          accessibilityLabel="Phone number"
        />
        {!codeSent ? (
          <Button
            title="Send code"
            onPress={onSendCode}
            loading={busy === "send"}
            disabled={busy !== null}
          />
        ) : (
          <>
            <TextInput
              style={inputStyle}
              value={code}
              onChangeText={setCode}
              placeholder="6-digit code"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              accessibilityLabel="Verification code"
            />
            <Button
              title="Confirm code"
              onPress={onConfirm}
              loading={busy === "confirm"}
              disabled={busy !== null}
            />
            <Button
              title="Resend code"
              variant="secondary"
              onPress={onSendCode}
              loading={busy === "send"}
              disabled={busy !== null}
            />
            <Button
              title="Change number"
              variant="secondary"
              onPress={() => {
                setCodeSent(false);
                setPhoneError(null);
              }}
              disabled={busy !== null}
            />
          </>
        )}
        {phoneError ? (
          <ThemedText type="small" style={styles.error}>
            {phoneError}
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  section: { marginTop: Spacing.four },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  error: { color: "#D93025" },
});

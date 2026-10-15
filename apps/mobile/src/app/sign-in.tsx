import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  Screen,
  SectionHeader,
  TextField,
} from "@/components/ui";
import { useUpdateMe } from "@/lib/api";
import { authErrorMessage, googleSignInConfigured, useAuth } from "@/lib/auth";
import { errorText } from "@/lib/error-messages";
import { goHome } from "@/lib/mode";

type Busy = "google" | "send" | "confirm" | null;

export default function SignInScreen() {
  const router = useRouter();
  // `mode=business`: the user picked Business mode while anonymous (IDN-08).
  const params = useLocalSearchParams<{ mode?: string }>();
  const toBusiness = params.mode === "business";
  const { signInWithGoogle, startPhoneSignIn, confirmPhoneCode } = useAuth();
  const updateMe = useUpdateMe();

  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const done = async () => {
    if (toBusiness) {
      try {
        await updateMe.mutateAsync({ preferredMode: "business" });
        goHome("business");
      } catch (e) {
        Alert.alert(
          "Signed in, but still in Customer mode",
          `${errorText(e)} Switch to Business mode again from Profile.`,
        );
        goHome("customer");
      }
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const onGoogle = async () => {
    setGoogleError(null);
    setBusy("google");
    try {
      if (await signInWithGoogle()) await done();
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
        await done();
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
      await done();
    } catch (e) {
      setPhoneError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      {toBusiness ? (
        <>
          <Stack.Screen options={{ title: "Sign in for Business mode" }} />
          <ThemedText type="body">
            Business mode needs an account. Sign in with Google or your phone,
            and the app switches to Business mode for you.
          </ThemedText>
        </>
      ) : null}

      <SectionHeader title="Google" />
      <Card>
        {googleSignInConfigured ? (
          <Button
            title="Continue with Google"
            icon="login"
            onPress={onGoogle}
            loading={busy === "google"}
            disabled={busy !== null}
          />
        ) : (
          <ThemedText type="small" themeColor="inkMuted">
            Google sign-in is not set up in this build yet.
          </ThemedText>
        )}
        {googleError ? (
          <ThemedText type="small" themeColor="danger">
            {googleError}
          </ThemedText>
        ) : null}
      </Card>

      <SectionHeader title="Phone" />
      <Card>
        <TextField
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98765 43210"
          keyboardType="phone-pad"
          autoComplete="tel"
          editable={!codeSent && busy === null}
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
            <TextField
              label="Code from the SMS"
              value={code}
              onChangeText={setCode}
              placeholder="6-digit code"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
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
              variant="outline"
              onPress={() => {
                setCodeSent(false);
                setPhoneError(null);
              }}
              disabled={busy !== null}
            />
          </>
        )}
        {phoneError ? (
          <ThemedText type="small" themeColor="danger">
            {phoneError}
          </ThemedText>
        ) : null}
      </Card>
    </Screen>
  );
}

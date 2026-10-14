import {
  type AuthCredential,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  getAuth,
  getIdToken,
  linkWithCredential,
  type NativeFirebaseAuthError,
  onAuthStateChanged,
  PhoneAuthProvider,
  type PhoneAuthSnapshot,
  signInAnonymously,
  signInWithCredential,
  type User,
  verifyPhoneNumber,
} from "@react-native-firebase/auth";
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { config } from "@/config";

const auth = getAuth();

if (__DEV__) {
  // Lets Firebase *testing* phone numbers work without Play Integrity /
  // reCAPTCHA. Real numbers do not receive SMS while this is on.
  auth.settings.appVerificationDisabledForTesting = true;
}

if (config.googleWebClientId) {
  GoogleSignin.configure({ webClientId: config.googleWebClientId });
}

export const googleSignInConfigured = Boolean(config.googleWebClientId);

/** An error with a message that is safe to show to the user as-is. */
export class AuthUiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthUiError";
  }
}

const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/invalid-phone-number":
    "That phone number is not valid. Include the country code, e.g. +91 98765 43210.",
  "auth/missing-phone-number": "Enter a phone number.",
  "auth/invalid-verification-code":
    "That code is wrong. Check it and try again.",
  "auth/missing-verification-code": "Enter the code from the SMS.",
  "auth/invalid-verification-id":
    "This code request has expired. Send a new code.",
  "auth/session-expired": "The code has expired. Send a new code.",
  "auth/code-expired": "The code has expired. Send a new code.",
  "auth/too-many-requests": "Too many attempts. Wait a while and try again.",
  "auth/quota-exceeded": "SMS limit reached. Try again later.",
  "auth/network-request-failed": "No internet connection. Try again.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/operation-not-allowed":
    "This sign-in method is not enabled in Firebase yet.",
  "auth/app-not-authorized":
    "This app build is not authorised in Firebase (check the SHA-1 fingerprint).",
  "auth/invalid-credential": "Sign-in failed. Please try again.",
};

/** Turns any auth-related error into a readable sentence. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthUiError) return error.message;
  if (isErrorWithCode(error)) {
    const known = FIREBASE_MESSAGES[error.code];
    if (known) return known;
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return "Google Play services is missing or out of date.";
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return "Sign-in is already in progress.";
    }
    if (error.code === "DEVELOPER_ERROR" || error.code === "10") {
      return "Google sign-in is misconfigured (check the SHA-1 fingerprint and web client ID).";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

function errorCode(error: unknown): string | undefined {
  return isErrorWithCode(error) ? error.code : undefined;
}

/** A short label for how the user is signed in, e.g. "google.com". */
export function providerOf(user: User | null): string {
  if (!user) return "none";
  if (user.isAnonymous) return "anonymous";
  const ids = user.providerData.map((p) => p.providerId);
  return ids.length > 0 ? ids.join(", ") : "unknown";
}

type AuthState = {
  user: User | null;
  /** Bumped whenever the user object may have changed in place (linking). */
  revision: number;
};

export type AuthContextValue = {
  user: User | null;
  /** Changes whenever the user's providers may have changed. */
  revision: number;
  initializing: boolean;
  /** Set when the automatic anonymous sign-in failed. */
  error: string | null;
  /** Returns false when the user cancelled the Google dialog. */
  signInWithGoogle: () => Promise<boolean>;
  /** Sends the SMS code. Resolves to true if Android verified the number automatically. */
  startPhoneSignIn: (phoneNumber: string) => Promise<boolean>;
  confirmPhoneCode: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, revision: 0 });
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const anonymousInFlight = useRef(false);
  const verificationId = useRef<string | null>(null);

  const publish = useCallback((user: User | null) => {
    setState((prev) => ({ user, revision: prev.revision + 1 }));
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      publish(user);
      if (user) {
        setInitializing(false);
        setError(null);
        return;
      }
      // IDN-01 / IDN-07: there is always a user; anonymous when nobody signed in.
      if (anonymousInFlight.current) return;
      anonymousInFlight.current = true;
      signInAnonymously(auth)
        .catch((e: unknown) => {
          setError(authErrorMessage(e));
          setInitializing(false);
        })
        .finally(() => {
          anonymousInFlight.current = false;
        });
    });
  }, [publish]);

  /**
   * IDN-04: an anonymous user is upgraded in place (same uid); anyone else
   * signs in with the credential.
   */
  const linkOrSignIn = useCallback(
    async (credential: AuthCredential) => {
      const current = auth.currentUser;
      if (current?.isAnonymous) {
        try {
          await linkWithCredential(current, credential);
        } catch (e) {
          if (errorCode(e) !== "auth/credential-already-in-use") throw e;
          // TODO(IDN-05): the credential belongs to an existing account. For now
          // we switch to that account and abandon the anonymous one; IDN-05 will
          // move the anonymous user's tokens or show a clear message.
          const updated = (e as NativeFirebaseAuthError).userInfo
            ?.authCredential;
          await signInWithCredential(auth, updated ?? credential);
        }
      } else {
        await signInWithCredential(auth, credential);
      }
      const user = auth.currentUser;
      if (user) {
        // Make sure the backend sees the new provider straight away.
        await getIdToken(user, true);
      }
      publish(auth.currentUser);
    },
    [publish],
  );

  const signInWithGoogle = useCallback(async () => {
    if (!config.googleWebClientId) {
      throw new AuthUiError("Google sign-in is not configured yet.");
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    let response: Awaited<ReturnType<typeof GoogleSignin.signIn>>;
    try {
      response = await GoogleSignin.signIn();
    } catch (e) {
      if (errorCode(e) === statusCodes.SIGN_IN_CANCELLED) return false;
      throw e;
    }
    if (isCancelledResponse(response)) return false;
    const { idToken } = response.data;
    if (!idToken) {
      throw new AuthUiError("Google did not return an ID token.");
    }
    await linkOrSignIn(GoogleAuthProvider.credential(idToken));
    return true;
  }, [linkOrSignIn]);

  const startPhoneSignIn = useCallback(
    (phoneNumber: string) =>
      new Promise<boolean>((resolve, reject) => {
        verificationId.current = null;
        let settled = false;
        const onSnapshot = (snapshot: PhoneAuthSnapshot) => {
          if (settled) return;
          if (snapshot.state === "error") {
            settled = true;
            reject(snapshot.error ?? new Error("Phone verification failed."));
            return;
          }
          verificationId.current = snapshot.verificationId;
          if (snapshot.state === "verified" && snapshot.code) {
            // Android read the SMS itself; finish without the user typing it.
            settled = true;
            linkOrSignIn(
              PhoneAuthProvider.credential(
                snapshot.verificationId,
                snapshot.code,
              ),
            ).then(() => resolve(true), reject);
            return;
          }
          if (snapshot.state === "sent" || snapshot.state === "timeout") {
            settled = true;
            resolve(false);
          }
        };
        try {
          verifyPhoneNumber(auth, phoneNumber).on(
            "state_changed",
            onSnapshot,
            (e) => {
              if (settled) return;
              settled = true;
              reject(
                new AuthUiError(
                  (e.code && FIREBASE_MESSAGES[e.code]) ||
                    e.message ||
                    "Phone verification failed.",
                  e.code ?? undefined,
                ),
              );
            },
          );
        } catch (e) {
          reject(e);
        }
      }),
    [linkOrSignIn],
  );

  const confirmPhoneCode = useCallback(
    async (code: string) => {
      const id = verificationId.current;
      if (!id) throw new AuthUiError("Send a code first.");
      const trimmed = code.trim();
      if (!trimmed) throw new AuthUiError("Enter the code from the SMS.");
      await linkOrSignIn(PhoneAuthProvider.credential(id, trimmed));
      verificationId.current = null;
    },
    [linkOrSignIn],
  );

  const signOut = useCallback(async () => {
    if (config.googleWebClientId && GoogleSignin.hasPreviousSignIn()) {
      try {
        await GoogleSignin.signOut();
      } catch {
        // Not fatal: Firebase sign-out below is what matters.
      }
    }
    // The auth listener then signs in anonymously again (IDN-07).
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      revision: state.revision,
      initializing,
      error,
      signInWithGoogle,
      startPhoneSignIn,
      confirmPhoneCode,
      signOut,
    }),
    [
      state,
      initializing,
      error,
      signInWithGoogle,
      startPhoneSignIn,
      confirmPhoneCode,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}

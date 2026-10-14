import { createRemoteJWKSet, jwtVerify } from "jose";

export interface VerifiedUser {
  uid: string;
  isAnonymous: boolean;
  email: string | null;
  phone: string | null;
  name: string | null;
}

export type TokenVerifier = (token: string) => Promise<VerifiedUser>;

export type KeySource = Parameters<typeof jwtVerify>[1];

const GOOGLE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const productionKeySet = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export function makeFirebaseVerifier(
  projectId: string,
  keySource?: KeySource,
): TokenVerifier {
  const keys = keySource ?? productionKeySet;
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const expectedAudience = projectId;

  return async (token: string): Promise<VerifiedUser> => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: expectedIssuer,
      audience: expectedAudience,
      algorithms: ["RS256"],
    });

    if (
      !payload.sub ||
      typeof payload.sub !== "string" ||
      payload.sub.trim() === ""
    ) {
      throw new Error("Invalid token: sub must be a non-empty string");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      typeof payload.auth_time === "number" &&
      payload.auth_time > nowSeconds
    ) {
      throw new Error("Invalid token: auth_time is in the future");
    }

    const firebase = payload.firebase as
      | { sign_in_provider?: string }
      | undefined;
    const isAnonymous = firebase?.sign_in_provider === "anonymous";

    const email = typeof payload.email === "string" ? payload.email : null;
    const phone =
      typeof payload.phone_number === "string"
        ? payload.phone_number
        : typeof payload.phone === "string"
          ? payload.phone
          : null;
    const name = typeof payload.name === "string" ? payload.name : null;

    return {
      uid: payload.sub,
      isAnonymous,
      email,
      phone,
      name,
    };
  };
}

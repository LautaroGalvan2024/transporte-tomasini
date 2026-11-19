export type InvitationPreview = {
  role: "ADMIN" | "DRIVER";
  name: string | null;
  driverName: string | null;
  expiresAt: string;
  replacesExistingAccess: boolean;
};

export type InvitationAcceptance = Readonly<{
  token: string;
  name: string;
  username: string;
  password: string;
}>;

export function invitationAttempt(
  pending: InvitationAcceptance | null,
  values: InvitationAcceptance,
): InvitationAcceptance {
  // Keep credentials only in the component's existing in-memory attempt.
  return (
    pending ??
    Object.freeze({
      token: values.token,
      name: values.name.trim(),
      username: values.username.trim(),
      password: values.password,
    })
  );
}

export function invitationAttemptIsUncertain(
  error: { status: number; code: string },
  wasUncertain: boolean,
) {
  return (
    error.status === 0 ||
    error.status >= 500 ||
    error.code === "INVITATION_UNAVAILABLE" ||
    (wasUncertain && !["USERNAME_TAKEN", "VALIDATION"].includes(error.code))
  );
}

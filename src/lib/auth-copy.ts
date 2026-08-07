export type SignupSuccessState = {
  confirmationRequired: boolean;
};

/** Return honest signup copy for both auto-confirm and email-confirm projects. */
export function signupSuccessMessage({
  confirmationRequired,
}: SignupSuccessState) {
  if (confirmationRequired) return "Account created! Check your email to finish signing in.";
  return "Account created! You’re ready to start.";
}

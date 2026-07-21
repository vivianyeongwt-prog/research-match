export type SignupSuccessState = {
  promoApplied: boolean;
  promoPending: boolean;
  confirmationRequired: boolean;
};

/** Return honest signup copy for both auto-confirm and email-confirm projects. */
export function signupSuccessMessage({
  promoApplied,
  promoPending,
  confirmationRequired,
}: SignupSuccessState) {
  if (promoApplied) return "Account created with Student access! You’re ready to start.";
  if (promoPending) return "Account created! Confirm your email to activate the promo code.";
  if (confirmationRequired) return "Account created! Check your email to finish signing in.";
  return "Account created! You’re ready to start.";
}

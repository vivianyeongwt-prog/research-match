import { supabaseAdmin } from "@/lib/server-access";

export async function voidBuddyPassRewardsForCheckoutSessions(
  checkoutSessionIds: string[]
): Promise<boolean> {
  const uniqueIds = [...new Set(checkoutSessionIds.filter(Boolean))];
  if (uniqueIds.length === 0) return false;

  const { data: voidedCount, error } = await supabaseAdmin.rpc(
    "void_buddy_pass_rewards",
    { p_checkout_session_ids: uniqueIds }
  );
  if (error) {
    console.error("Buddy Pass reward reversal failed", error);
    return true;
  }
  if (Number(voidedCount ?? 0) > 0) {
    console.info("Buddy Pass rewards voided", { count: Number(voidedCount) });
  }
  return false;
}

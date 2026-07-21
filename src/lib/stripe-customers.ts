// Shared billing-route helpers. customer-portal and cancel-subscription used to
// carry byte-identical private copies of these; the verified-email security fix
// had to be applied to both in lockstep, which is exactly the failure mode this
// module exists to prevent.
import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/server-access";

// Identify the caller from their verified Supabase bearer token. Both the id and
// the email come from the token — never from the request body or the profiles row.
export async function authenticatedUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

// Resolve every Stripe customer that belongs to this user: subscriptions tagged
// with their userId and customers matching their AUTH-VERIFIED email. Never look
// up by profiles.email. Even though RLS now protects that row, the verified Auth
// identity remains the only appropriate billing authority.
export async function customerIdsForUser(
  stripe: Stripe,
  userId: string,
  verifiedEmail: string | null
) {
  const customerIds = new Set<string>();

  try {
    const subscriptions = await stripe.subscriptions.search({
      query: `metadata['userId']:'${userId.replace(/'/g, "\\'")}'`,
      limit: 100,
    });

    subscriptions.data.forEach((subscription) => {
      const customer = subscription.customer;
      if (typeof customer === "string") {
        customerIds.add(customer);
      } else if (!("deleted" in customer && customer.deleted)) {
        customerIds.add(customer.id);
      }
    });
  } catch (err) {
    console.warn("Subscription metadata lookup failed:", err);
  }

  if (verifiedEmail) {
    const customers = await stripe.customers.list({ email: verifiedEmail, limit: 10 });
    customers.data.forEach((customer) => customerIds.add(customer.id));
  }

  return [...customerIds];
}

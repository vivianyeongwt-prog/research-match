export const RESEARCHMATCH_WEBHOOK_EVENTS = Object.freeze([
  "checkout.session.completed",
  "customer.subscription.deleted",
  "customer.subscription.updated",
  "invoice.payment_failed",
  "invoice.paid",
  "charge.refunded",
  "charge.dispute.created",
]);

export const RESEARCHMATCH_PRICE_SPECS = Object.freeze([
  {
    plan: "weekly",
    lookupKey: "researchmatch_weekly_v1",
    unitAmount: 700,
    nickname: "ResearchMatch Weekly",
    recurring: { interval: "week", interval_count: 1 },
    envNames: ["NEXT_PUBLIC_STRIPE_PRICE_WEEKLY", "STRIPE_PRICE_WEEKLY"],
  },
  {
    plan: "semester",
    lookupKey: "researchmatch_four_month_v1",
    unitAmount: 2900,
    nickname: "ResearchMatch Four-Month",
    recurring: { interval: "month", interval_count: 4 },
    envNames: ["NEXT_PUBLIC_STRIPE_PRICE_SEMESTER", "STRIPE_PRICE_SEMESTER"],
  },
  {
    plan: "lifetime",
    lookupKey: "researchmatch_lifetime_v1",
    unitAmount: 5900,
    nickname: "ResearchMatch Lifetime",
    recurring: null,
    envNames: ["NEXT_PUBLIC_STRIPE_PRICE_LIFETIME", "STRIPE_PRICE_LIFETIME"],
  },
]);

export const RESEARCHMATCH_COUPON_SPECS = Object.freeze([
  {
    key: "buddy",
    id: "research_buddy_pass_25",
    name: "ResearchMatch Buddy Pass — 25% once",
    percentOff: 25,
    envName: "STRIPE_BUDDY_PASS_COUPON_ID",
  },
  {
    key: "affiliate",
    id: "research_oxfordphd_20",
    name: "Oxford PhD — 20% off first payment",
    percentOff: 20,
    envName: "STRIPE_AFFILIATE_COUPON_ID",
  },
]);

const AFFILIATE_CODE = "OXFORDPHD777";

function isMissingResource(error) {
  return Boolean(error && typeof error === "object" && error.code === "resource_missing");
}

function couponId(promotionCode) {
  const coupon = promotionCode?.promotion?.coupon;
  return typeof coupon === "string" ? coupon : coupon?.id ?? null;
}

function priceMatches(price, spec) {
  if (
    !price ||
    !price.active ||
    price.currency !== "usd" ||
    price.unit_amount !== spec.unitAmount ||
    price.lookup_key !== spec.lookupKey
  ) {
    return false;
  }
  if (!spec.recurring) return price.type === "one_time" && !price.recurring;
  return (
    price.type === "recurring" &&
    price.recurring?.interval === spec.recurring.interval &&
    price.recurring?.interval_count === spec.recurring.interval_count
  );
}

function couponMatches(coupon, spec) {
  return Boolean(
    coupon &&
      !("deleted" in coupon) &&
      coupon.valid &&
      coupon.percent_off === spec.percentOff &&
      coupon.duration === "once"
  );
}

function webhookMatches(endpoint) {
  return RESEARCHMATCH_WEBHOOK_EVENTS.every(
    (event) => endpoint.enabled_events.includes("*") || endpoint.enabled_events.includes(event)
  );
}

async function retrieveCoupon(stripe, id) {
  try {
    return await stripe.coupons.retrieve(id);
  } catch (error) {
    if (isMissingResource(error)) return null;
    throw error;
  }
}

export async function inspectBuyerStripe(stripe, env) {
  const site = new URL(String(env.NEXT_PUBLIC_SITE_URL ?? ""));
  const webhookOverride = String(env.STRIPE_WEBHOOK_URL ?? "").trim();
  const webhookUrl = webhookOverride
    ? new URL(webhookOverride).toString()
    : new URL("/api/webhooks/stripe", site).toString();
  const parsedWebhookUrl = new URL(webhookUrl);
  if (parsedWebhookUrl.protocol !== "https:" || parsedWebhookUrl.pathname !== "/api/webhooks/stripe") {
    throw new Error("The Stripe webhook URL must use HTTPS and end at /api/webhooks/stripe.");
  }
  const [account, products, prices, promotionCodes, webhooks, ...coupons] = await Promise.all([
    stripe.accounts.retrieve(),
    stripe.products.list({ active: true, limit: 100 }),
    stripe.prices.list({
      active: true,
      lookup_keys: RESEARCHMATCH_PRICE_SPECS.map((spec) => spec.lookupKey),
      limit: 100,
    }),
    stripe.promotionCodes.list({ code: AFFILIATE_CODE, active: true, limit: 100 }),
    stripe.webhookEndpoints.list({ limit: 100 }),
    ...RESEARCHMATCH_COUPON_SPECS.map((spec) => retrieveCoupon(stripe, spec.id)),
  ]);
  const product = products.data.find(
    (candidate) => candidate.metadata?.researchmatch_app === "true"
  ) ?? null;
  const priceByPlan = Object.fromEntries(
    RESEARCHMATCH_PRICE_SPECS.map((spec) => [
      spec.plan,
      prices.data.find((price) => price.lookup_key === spec.lookupKey) ?? null,
    ])
  );
  const couponByKey = Object.fromEntries(
    RESEARCHMATCH_COUPON_SPECS.map((spec, index) => [spec.key, coupons[index] ?? null])
  );
  const matchingWebhooks = webhooks.data.filter(
    (endpoint) => endpoint.status === "enabled" && endpoint.url === webhookUrl
  );
  const promotionCode = promotionCodes.data[0] ?? null;
  const blockers = [];

  if (!String(env.BUYER_STRIPE_ACCOUNT_ID ?? "").startsWith("acct_")) {
    blockers.push("Buyer Stripe account ID is missing.");
  } else if (env.BUYER_STRIPE_ACCOUNT_ID !== account.id) {
    blockers.push(
      `The pasted Stripe key belongs to ${account.id}, not the confirmed buyer account ${env.BUYER_STRIPE_ACCOUNT_ID}.`
    );
  }

  for (const spec of RESEARCHMATCH_PRICE_SPECS) {
    const price = priceByPlan[spec.plan];
    if (price && !priceMatches(price, spec)) {
      blockers.push(`Stripe lookup key ${spec.lookupKey} exists with the wrong price settings.`);
    }
  }
  for (const spec of RESEARCHMATCH_COUPON_SPECS) {
    const coupon = couponByKey[spec.key];
    if (coupon && !couponMatches(coupon, spec)) {
      blockers.push(`Stripe coupon ${spec.id} exists with the wrong discount settings.`);
    }
  }
  if (promotionCode && couponId(promotionCode) !== RESEARCHMATCH_COUPON_SPECS[1].id) {
    blockers.push(`${AFFILIATE_CODE} already points to a different Stripe coupon.`);
  }
  if (matchingWebhooks.length > 1) {
    blockers.push(`More than one enabled Stripe webhook points to ${webhookUrl}.`);
  }
  if (
    matchingWebhooks[0] &&
    matchingWebhooks[0].metadata?.researchmatch_app !== "true"
  ) {
    blockers.push(
      "A webhook already uses the ResearchMatch URL but was not created by buyer setup. Review it manually instead of guessing its signing secret."
    );
  }
  if (matchingWebhooks[0] && !webhookMatches(matchingWebhooks[0])) {
    blockers.push("The existing ResearchMatch webhook is missing required event types.");
  }
  if (matchingWebhooks[0] && !String(env.STRIPE_WEBHOOK_SECRET ?? "").startsWith("whsec_")) {
    blockers.push(
      "The webhook already exists, but its signing secret is not configured. Roll its signing secret in Stripe and paste it into buyer setup."
    );
  }

  return {
    account,
    webhookUrl,
    product,
    priceByPlan,
    couponByKey,
    promotionCode,
    webhook: matchingWebhooks[0] ?? null,
    blockers,
  };
}

function plannedActions(inspection) {
  const actions = [];
  if (!inspection.product) actions.push("Create the ResearchMatch product");
  for (const spec of RESEARCHMATCH_PRICE_SPECS) {
    if (!inspection.priceByPlan[spec.plan]) actions.push(`Create the ${spec.nickname} price`);
  }
  for (const spec of RESEARCHMATCH_COUPON_SPECS) {
    if (!inspection.couponByKey[spec.key]) actions.push(`Create ${spec.percentOff}% ${spec.key} coupon`);
  }
  if (!inspection.promotionCode) actions.push(`Create public code ${AFFILIATE_CODE}`);
  if (!inspection.webhook) actions.push("Create and sign the production webhook");
  return actions;
}

export async function provisionBuyerStripe(stripe, env, { apply = false } = {}) {
  const inspection = await inspectBuyerStripe(stripe, env);
  if (inspection.blockers.length > 0) {
    throw new Error(`Stripe setup needs attention:\n- ${inspection.blockers.join("\n- ")}`);
  }
  const actions = plannedActions(inspection);
  if (!apply) {
    return { inspection, actions, envUpdates: {}, changed: false };
  }

  let product = inspection.product;
  if (!product) {
    product = await stripe.products.create(
      {
        name: "ResearchMatch",
        description: "Professor matching and research outreach tools for students",
        metadata: { researchmatch_app: "true", setup_version: "1" },
      },
      { idempotencyKey: "researchmatch:buyer-setup:product:v1" }
    );
  }

  const prices = {};
  for (const spec of RESEARCHMATCH_PRICE_SPECS) {
    let price = inspection.priceByPlan[spec.plan];
    if (!price) {
      price = await stripe.prices.create(
        {
          product: product.id,
          currency: "usd",
          unit_amount: spec.unitAmount,
          nickname: spec.nickname,
          lookup_key: spec.lookupKey,
          ...(spec.recurring ? { recurring: spec.recurring } : {}),
          metadata: { researchmatch_plan: spec.plan, setup_version: "1" },
        },
        { idempotencyKey: `researchmatch:buyer-setup:price:${spec.plan}:v1` }
      );
    }
    if (!priceMatches(price, spec)) {
      throw new Error(`Created Stripe price for ${spec.plan} did not match the expected contract.`);
    }
    prices[spec.plan] = price;
  }

  const coupons = {};
  for (const spec of RESEARCHMATCH_COUPON_SPECS) {
    let coupon = inspection.couponByKey[spec.key];
    if (!coupon) {
      coupon = await stripe.coupons.create(
        {
          id: spec.id,
          name: spec.name,
          percent_off: spec.percentOff,
          duration: "once",
          metadata: { researchmatch_discount: spec.key, setup_version: "1" },
        },
        { idempotencyKey: `researchmatch:buyer-setup:coupon:${spec.key}:v1` }
      );
    }
    if (!couponMatches(coupon, spec)) {
      throw new Error(`Created Stripe coupon ${spec.id} did not match the expected contract.`);
    }
    coupons[spec.key] = coupon;
  }

  let promotionCode = inspection.promotionCode;
  if (!promotionCode) {
    promotionCode = await stripe.promotionCodes.create(
      {
        promotion: { type: "coupon", coupon: coupons.affiliate.id },
        code: AFFILIATE_CODE,
        metadata: { affiliate_name: "The Oxford PhD", setup_version: "1" },
      },
      { idempotencyKey: "researchmatch:buyer-setup:promotion:oxfordphd:v1" }
    );
  }
  if (couponId(promotionCode) !== coupons.affiliate.id) {
    throw new Error(`Created promotion code ${AFFILIATE_CODE} points to the wrong coupon.`);
  }

  let webhook = inspection.webhook;
  if (!webhook) {
    webhook = await stripe.webhookEndpoints.create(
      {
        url: inspection.webhookUrl,
        enabled_events: [...RESEARCHMATCH_WEBHOOK_EVENTS],
        description: "ResearchMatch production billing events",
        metadata: { researchmatch_app: "true", setup_version: "1" },
      },
      { idempotencyKey: "researchmatch:buyer-setup:webhook:v1" }
    );
  }
  if (!webhookMatches(webhook)) {
    throw new Error("Created Stripe webhook is missing required events.");
  }

  const envUpdates = {
    STRIPE_BUDDY_PASS_COUPON_ID: coupons.buddy.id,
    STRIPE_AFFILIATE_COUPON_ID: coupons.affiliate.id,
  };
  for (const spec of RESEARCHMATCH_PRICE_SPECS) {
    for (const name of spec.envNames) envUpdates[name] = prices[spec.plan].id;
  }
  if (webhook.secret) envUpdates.STRIPE_WEBHOOK_SECRET = webhook.secret;
  else envUpdates.STRIPE_WEBHOOK_SECRET = String(env.STRIPE_WEBHOOK_SECRET ?? "");

  return {
    inspection: { ...inspection, product, promotionCode, webhook },
    actions,
    envUpdates,
    changed: actions.length > 0,
  };
}

export const RESEARCHMATCH_AFFILIATE_CODE = AFFILIATE_CODE;

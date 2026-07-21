import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("backend structure", () => {
  it("keeps Stripe construction and secret validation out of route files", () => {
    const routes = filesUnder(join(root, "src/app/api"))
      .filter((file) => file.endsWith("route.ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(routes).not.toContain("new Stripe(");
    expect(routes).not.toContain("process.env.STRIPE_SECRET_KEY!");
    expect(routes).not.toContain("process.env.STRIPE_WEBHOOK_SECRET!");
  });

  it("keeps the Stripe webhook route focused on event orchestration", () => {
    const route = readFileSync(
      join(root, "src/app/api/webhooks/stripe/route.ts"),
      "utf8"
    );
    expect(route.split("\n").length).toBeLessThan(450);
    expect(route).toContain('from "@/lib/stripe-webhook"');
    expect(route).toContain("if (!signature)");
  });
});

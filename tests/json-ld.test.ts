import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "../src/lib/json-ld";

describe("structured-data serialization", () => {
  it("cannot be escaped with an injected closing script tag", () => {
    const serialized = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("</script>");
    expect(JSON.parse(serialized)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("escapes JavaScript line separators while preserving JSON meaning", () => {
    const value = { text: `before\u2028middle\u2029after` };
    const serialized = serializeJsonLd(value);
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(JSON.parse(serialized)).toEqual(value);
  });
});

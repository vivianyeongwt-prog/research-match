import { NextRequest, NextResponse } from "next/server";
import { isPlausibleEmail } from "@/lib/rate-limit";
import { allowRequestRate, supabaseAdmin } from "@/lib/server-access";

/* ── POST: save email ────────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    if (!(await allowRequestRate(req, "starter-kit", 5))) {
      return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
    }

    const { email } = await req.json();
    if (!isPlausibleEmail(email)) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("pdf_downloads").insert({
      email: email.trim().toLowerCase(),
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("pdf_downloads insert error:", error);
      return NextResponse.json(
        { error: "Failed to save email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("starter-kit POST error:", err);
    return NextResponse.json({ error: "Could not prepare the starter kit." }, { status: 500 });
  }
}

/* ── GET: serve the PDF ──────────────────────────────────── */
export async function GET() {
  const pdf = buildPDF();
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'attachment; filename="Research-Position-Starter-Kit.pdf"',
      "Content-Length": String(pdf.length),
    },
  });
}

/* ─────────────────────────────────────────────────────────
   Raw PDF generator — no external libraries.
   Uses the PDF-1.4 spec with Helvetica (a standard PDF font).
   ───────────────────────────────────────────────────────── */

function buildPDF(): Buffer {
  const objects: string[] = [];
  let objCount = 0;
  const offsets: number[] = [];

  function addObj(content: string): number {
    objCount++;
    objects.push(`${objCount} 0 obj\n${content}\nendobj\n`);
    return objCount;
  }

  // ── 1. Catalog ──
  addObj("<< /Type /Catalog /Pages 2 0 R >>");

  // ── 2. Pages ──
  addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");

  // ── Build page content stream ──
  const lines = buildContentStream();
  const stream = lines.join("\n");
  const streamBytes = Buffer.from(stream, "latin1");

  // ── 3. Page ──
  addObj(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 5 0 R
   /Resources <<
     /Font <<
       /F1 4 0 R
       /F2 6 0 R
       /F3 7 0 R
     >>
   >>
>>`
  );

  // ── 4. Font: Helvetica (body) ──
  addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  );

  // ── 5. Content stream ──
  addObj(
    `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`
  );

  // ── 6. Font: Helvetica-Bold ──
  addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  );

  // ── 7. Font: Helvetica-Oblique ──
  addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>"
  );

  // ── Assemble ──
  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += objects[i];
  }

  const xrefOffset = body.length;
  let xref = `xref\n0 ${objCount + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}

/* ── Content stream helpers ──────────────────────────────── */

function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildContentStream(): string[] {
  const L: string[] = [];
  let y = 750; // current y position (top of page)

  const PAGE_LEFT = 56;
  const PAGE_RIGHT = 556;

  // ── Decorative header bar ──
  L.push("0.11 0.478 0.337 rg"); // #1c7a53
  L.push("0 762 612 30 re f");

  // ── Title ──
  y = 720;
  L.push("BT");
  L.push(`/F2 22 Tf`);
  L.push("0.11 0.478 0.337 rg"); // dark green
  L.push(`${PAGE_LEFT} ${y} Td`);
  L.push(`(${esc("The Research Position Starter Kit")}) Tj`);
  L.push("ET");

  // ── Subtitle ──
  y -= 22;
  L.push("BT");
  L.push(`/F3 10.5 Tf`);
  L.push("0.29 0.37 0.31 rg"); // #4A5D50
  L.push(`${PAGE_LEFT} ${y} Td`);
  L.push(
    `(${esc(
      "Everything you need to cold email professors, based on advice from 30+ real professors"
    )}) Tj`
  );
  L.push("ET");

  // ── Thin rule ──
  y -= 14;
  L.push("0.82 0.78 0.72 RG"); // light tan line
  L.push("0.5 w");
  L.push(`${PAGE_LEFT} ${y} m ${PAGE_RIGHT} ${y} l S`);

  // ── Section 1 ──
  y -= 26;
  y = sectionTitle(L, "1. Before You Email", PAGE_LEFT, y);
  y = bullet(L, "Find professors whose work matches YOUR interests, not just big names", PAGE_LEFT, y);
  y = bullet(L, "Check their faculty website for contact instructions", PAGE_LEFT, y);
  y = bullet(L, "Check NIH Reporter for funding status", PAGE_LEFT, y);
  y = bullet(L, "Look at their recent papers where they are first or last author", PAGE_LEFT, y);
  y = bullet(L, "Use Research Match to do all of this in 5 minutes", PAGE_LEFT, y);

  // ── Section 2 ──
  y -= 14;
  y = sectionTitle(L, "2. The Email Format That Works", PAGE_LEFT, y);
  y = bullet(L, "Paragraph 1: Who you are and what interests YOU", PAGE_LEFT, y);
  y = bullet(L, "Paragraph 2: How your interests connect to their work + a specific question", PAGE_LEFT, y);
  y = bullet(L, "Paragraph 3: Direct ask, volunteer offer, redirect line", PAGE_LEFT, y);

  // ── Section 3 ──
  y -= 14;
  y = sectionTitle(L, "3. What Gets You Deleted", PAGE_LEFT, y);
  y = bullet(L, "AI-written emails", PAGE_LEFT, y);
  y = bullet(L, "Name-dropping papers without substance", PAGE_LEFT, y);
  y = bullet(L, "Sycophantic tone", PAGE_LEFT, y);
  y = bullet(L, "Generic emails that could go to anyone", PAGE_LEFT, y);
  y = bullet(L, "Referencing middle-author papers", PAGE_LEFT, y);

  // ── Section 4 ──
  y -= 14;
  y = sectionTitle(L, "4. The Secret Weapon Line", PAGE_LEFT, y);
  y -= 4;
  // Quoted block with light green background
  const quoteBoxH = 36;
  L.push("0.92 0.96 0.93 rg"); // light green bg
  L.push(`${PAGE_LEFT} ${y - quoteBoxH + 8} ${PAGE_RIGHT - PAGE_LEFT} ${quoteBoxH} re f`);
  L.push("BT");
  L.push(`/F3 10 Tf`);
  L.push("0.11 0.478 0.337 rg");
  L.push(`${PAGE_LEFT + 12} ${y - 8} Td`);
  L.push(
    `(${esc(
      '"If you\'re not taking students, is there someone in your group'
    )}) Tj`
  );
  L.push(`0 -14 Td`);
  L.push(
    `(${esc('you\'d recommend I reach out to?"')}) Tj`
  );
  L.push("ET");

  // ── Footer ──
  y = 58;
  // Footer rule
  L.push("0.82 0.78 0.72 RG");
  L.push("0.5 w");
  L.push(`${PAGE_LEFT} ${y + 14} m ${PAGE_RIGHT} ${y + 14} l S`);

  L.push("BT");
  L.push(`/F3 8.5 Tf`);
  L.push("0.42 0.49 0.44 rg");
  L.push(`${PAGE_LEFT} ${y} Td`);
  L.push(
    `(${esc(
      "Built by a 15-year-old who used this exact approach to get responses from Princeton and ASU professors."
    )}) Tj`
  );
  L.push(`0 -13 Td`);
  L.push(`/F2 8.5 Tf`);
  L.push("0.11 0.478 0.337 rg");
  L.push(`(${esc("Try Research Match: researchmatch.site")}) Tj`);
  L.push("ET");

  return L;
}

function sectionTitle(L: string[], title: string, x: number, y: number): number {
  L.push("BT");
  L.push(`/F2 13 Tf`);
  L.push("0.11 0.478 0.337 rg");
  L.push(`${x} ${y} Td`);
  L.push(`(${esc(title)}) Tj`);
  L.push("ET");
  return y - 20;
}

function bullet(L: string[], text: string, x: number, y: number): number {
  // Bullet character
  L.push("BT");
  L.push(`/F1 9.5 Tf`);
  L.push("0.29 0.37 0.31 rg");
  L.push(`${x + 6} ${y} Td`);

  // Split long lines (approx 90 chars per line at 9.5pt Helvetica)
  const maxChars = 88;
  if (text.length <= maxChars) {
    L.push(`(${esc("\u2022  " + text)}) Tj`);
    L.push("ET");
    return y - 16;
  } else {
    // Word-wrap
    const words = text.split(" ");
    let line1 = "\u2022  ";
    let line2 = "   ";
    let onLine1 = true;
    for (const word of words) {
      if (onLine1 && (line1 + word).length <= maxChars) {
        line1 += word + " ";
      } else {
        onLine1 = false;
        line2 += word + " ";
      }
    }
    L.push(`(${esc(line1.trimEnd())}) Tj`);
    L.push(`0 -13 Td`);
    L.push(`(${esc(line2.trimEnd())}) Tj`);
    L.push("ET");
    return y - 29;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { allowRequestRate, requestAccess, supabaseAdmin } from "@/lib/server-access";

const CATEGORIES = new Set(["General Feedback", "Bug Report", "Feature Request"]);

async function authenticatedAdmin(req: NextRequest) {
  const access = await requestAccess(req);
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return !!access.user?.email && admins.includes(access.user.email.toLowerCase());
}

export async function GET(req: NextRequest) {
  if (!(await allowRequestRate(req, "feedback-read", 30))) {
    return NextResponse.json({ error: "Too many feedback requests." }, { status: 429 });
  }
  const sort = req.nextUrl.searchParams.get("sort") || "upvotes";
  const order = sort === "newest" ? "created_at" : "upvotes";

  const { data, error } = await supabaseAdmin
    .from("feedback")
    .select("*")
    .order(order, { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: "Could not load feedback." }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!(await allowRequestRate(req, "feedback-post", 5))) {
    return NextResponse.json({ error: "Too many submissions. Try again in a minute." }, { status: 429 });
  }

  const { content, category, author_name } = await req.json();

  if (
    typeof content !== "string" || !content.trim() || content.length > 5000 ||
    (category !== undefined && (typeof category !== "string" || !CATEGORIES.has(category))) ||
    (author_name !== undefined && (typeof author_name !== "string" || author_name.length > 100))
  ) {
    return NextResponse.json({ error: "Feedback content is required." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("feedback")
    .insert({
      content: content.trim(),
      category: category || "General Feedback",
      author_name: author_name?.trim() || "Anonymous",
      upvotes: 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Could not save feedback." }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  // Upvotes are anonymous by design; the per-IP cap just blunts scripted inflation.
  if (!(await allowRequestRate(req, "feedback-vote", 20))) {
    return NextResponse.json({ error: "Too many votes. Try again in a minute." }, { status: 429 });
  }

  const { id } = await req.json();

  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Valid ID required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.rpc("increment_upvotes", { row_id: id });
  if (error) return NextResponse.json({ error: "Could not record vote." }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
  if (!(await authenticatedAdmin(req))) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id, resolved } = await req.json();

  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Valid ID required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("feedback")
    .update({ resolved: !!resolved })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Could not update feedback." }, { status: 500 });
  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicUrl } from "@/lib/public-url";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(publicUrl("/login"), { status: 303 });
}

// src/app/api/auth/route.ts
import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { email } = await request.json();

  const { error } = await supabase.auth.signInWithOtp({ email });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    return NextResponse.json({ message: "OTP sent" }, { status: 200 });
  }
}

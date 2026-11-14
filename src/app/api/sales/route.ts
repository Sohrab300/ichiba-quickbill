import { NextRequest, NextResponse } from "next/server";
import { getSales, completeSale } from "@/lib/actions";

export async function GET() {
  const result = await getSales();
  return NextResponse.json(result, { status: result.statusCode || 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await completeSale(body);
    return NextResponse.json(result, { status: result.statusCode || 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Invalid JSON request";
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

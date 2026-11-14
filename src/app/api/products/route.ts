import { NextRequest, NextResponse } from "next/server";
import { getProducts, createProduct } from "@/lib/actions";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || undefined;
  const result = await getProducts(q);
  return NextResponse.json(result, { status: result.statusCode || 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createProduct(body);
    return NextResponse.json(result, { status: result.statusCode || 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Invalid JSON request";
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

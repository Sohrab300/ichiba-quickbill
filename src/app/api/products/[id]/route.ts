import { NextRequest, NextResponse } from "next/server";
import { updateProduct, deleteProduct } from "@/lib/actions";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const result = await updateProduct(id, body);
    return NextResponse.json(result, { status: result.statusCode || 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Invalid JSON request";
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const result = await deleteProduct(id);
  return NextResponse.json(result, { status: result.statusCode || 200 });
}

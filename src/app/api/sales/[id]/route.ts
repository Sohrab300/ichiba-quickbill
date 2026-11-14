import { NextRequest, NextResponse } from "next/server";
import { getSaleById } from "@/lib/actions";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const result = await getSaleById(id);
  return NextResponse.json(result, { status: result.statusCode || 200 });
}

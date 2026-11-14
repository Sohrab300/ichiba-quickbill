import { NextRequest, NextResponse } from "next/server";
import { lookupProduct } from "@/lib/actions";

/** GET /api/lookup/:code — barcode alias first, then item code. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ barcode: string }> }
) {
  const { barcode } = await context.params;
  const result = await lookupProduct(barcode);
  return NextResponse.json(result, { status: result.statusCode || 200 });
}

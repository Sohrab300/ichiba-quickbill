import { NextRequest, NextResponse } from "next/server";
import { getProductByBarcode } from "@/lib/actions";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ barcode: string }> }
) {
  const { barcode } = await context.params;
  const result = await getProductByBarcode(decodeURIComponent(barcode));
  return NextResponse.json(result, { status: result.statusCode || 200 });
}

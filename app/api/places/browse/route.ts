import { placesBrowseResponse } from "@/lib/places/paged-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  return placesBrowseResponse(request, { kind: "all" });
}

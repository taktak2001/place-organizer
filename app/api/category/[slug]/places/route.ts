import { placesBrowseResponse } from "@/lib/places/paged-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  return placesBrowseResponse(request, { kind: "category", slug: params.slug });
}

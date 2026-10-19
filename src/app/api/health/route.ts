import { connection } from "next/server";
import { getHealthReport } from "@/server/services/health";

export async function GET() {
  // Always evaluate at request time; never prerender a status snapshot.
  await connection();
  const report = await getHealthReport();
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}

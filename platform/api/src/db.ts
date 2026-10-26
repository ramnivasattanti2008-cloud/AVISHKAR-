import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

/** One client per process. The `schema` query parameter is Prisma's, not the pg driver's, so it is passed separately. */
export function createDb(databaseUrl: string): Db {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get("schema") ?? "public";
  url.searchParams.delete("schema");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) });
}

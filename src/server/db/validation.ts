import { z } from "zod";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Supabase Auth UID. Public IDs and idempotency keys remain UUID v4. */
export const actorIdSchema = z
  .string()
  .regex(UUID_PATTERN, "検証済みactor UIDがUUIDではありません");

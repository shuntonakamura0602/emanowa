import type { CreateReportInput } from "@/domain";

import type { CreateReportResult } from "./repository";

export type SubmitReportDependencies = {
  enforceRateLimit(actorId: string): Promise<void>;
  createReport(
    actorId: string,
    worldSlug: string,
    publicId: string,
    input: CreateReportInput,
    idempotencyKey: string,
  ): Promise<CreateReportResult>;
};

export async function submitReportCommand(
  command: {
    actorId: string;
    worldSlug: string;
    publicId: string;
    input: CreateReportInput;
    idempotencyKey: string;
  },
  dependencies: SubmitReportDependencies,
): Promise<CreateReportResult> {
  await dependencies.enforceRateLimit(command.actorId);
  return dependencies.createReport(
    command.actorId,
    command.worldSlug,
    command.publicId,
    command.input,
    command.idempotencyKey,
  );
}

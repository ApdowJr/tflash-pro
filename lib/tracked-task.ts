import { z } from "zod";
export const taskDefinitionSchema = z
  .object({
    objective: z.string().trim().min(1).max(500),
    path: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/)
      .refine(
        (path) => !path.split("/").some((s) => !s || s === "." || s === ".."),
      ),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((s) => s.toLowerCase()),
    continuationBudget: z.number().int().min(0).max(3),
  })
  .strict();
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type TrackedTask = TaskDefinition & {
  revision: string;
  state: "awaiting_evidence" | "criterion_matched" | "cancelled";
  verifiedAt: string | null;
  reason: string | null;
};

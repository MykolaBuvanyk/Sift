import { z } from "zod";

export const importFormatSchema = z.enum(["ndjson", "csv"]);

export const contactSchema = z.object({
  email: z.email(),
  full_name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
}).strict();

export type Contact = z.infer<typeof contactSchema>;
export type ImportFormat = z.infer<typeof importFormatSchema>;

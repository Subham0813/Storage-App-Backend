import { z } from "zod/v4";

export const filenameSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100, {
      message: "Filename must be between 1 and 100 characters long",
    })
    .regex(/^[^\\/:\*\?"<>|]+$/, {
      message: "Invalid characters in filename",
    })
    .trim(),
});

export const uploadInitSchema = z.object({
  filename: filenameSchema.shape.name,
  mimetype: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+$/, { message: "Invalid mimetype" }),
  size: z.number().positive(),
});

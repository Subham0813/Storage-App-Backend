import mongoose from "mongoose";
import { z } from "zod/v4";

export const filenameSchema = z.object({
  name: z
    .string()
    .min(1, {
      message: "Filename must be 1 or more characters long",
    })
    .regex(/^[^\\/:\*\?"<>|]+$/, {
      message: "Invalid characters in filename",
    })
    .trim(),
});

export const uploadInitSchema = z.object({
  id: z.string().trim().optional(),
  name: filenameSchema.shape.name,
  mime: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+$/, { message: "Invalid mimetype" }),
  size: z.number().gt(0),
  // hash: z.string().trim().regex(/^[a-f0-9]{64}$/, { message: "Invalid hash" }),
});

export const uploadCompleteSchema = z.object({
  parts: z.array(
    z.object({
      ETag: z.string(),
      partNumber: z.number().positive(),
    }),
  ),
  thumbnailBase64: z
    .string()
    .regex(/^data:image\/\w+;base64,/)
    .nullish()
});

export const sharePayloadSchema = z
  .object({
    emailsWithRole: z
      .array(
        z.object({
          email: z.email(),
          role: z.enum(["view", "edit"], {
            message: "Role must be either 'view' or 'edit'",
          }),
        }),
      )
      .min(0, {
        message: "At least one email with role is required to share",
      })
      .max(100, {
        message: "Maximum 100 emails allowed to share at once",
      })
      .optional(),
    publicRole: z
      .enum(["view"], { message: "publicRole must be 'view'" })
      .optional(),
    notify: z.boolean().optional().default(false),
    expiresIn: z
      .number()
      .gt(0, { message: "expiresIn must be greater than or equal to 0" })
      .nullable()
      .optional(),
    message: z.string().max(500).optional(),
  })
  .refine((data) => data.emailsWithRole || data.publicRole, {
    message: "At least one of email with role or publicRole must be provided.",
  });

export const revokePayloadSchema = z
  .object({
    emails: z
      .array(z.email())
      .min(1, { message: "At least one email is required." })
      .max(100, { message: "Maximum 100 emails allowed." })
      .optional(),
    publicRole: z.enum(["none"]).optional(),
    notify: z.boolean().optional().default(false),
    message: z.string().max(500).optional(),
  })
  .refine((data) => data.emails || data.publicRole, {
    message: "At least one of emails or publicRole must be provided.",
  });

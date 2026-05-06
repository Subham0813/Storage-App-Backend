import mongoose from "mongoose";
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
  name: filenameSchema.shape.name,
  mime: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+$/, { message: "Invalid mimetype" }),
  size: z.number().positive(),
  // hash: z.string().trim().regex(/^[a-f0-9]{64}$/, { message: "Invalid hash" }),
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
      .min(1, {
        message: "At least one email with role is required to share",
      })
      .max(100, {
        message: "Maximum 100 emails allowed to share at once",
      }),
    publicRole: z.enum(["view"],{message:"publicRole must be 'view'"}).optional(),
    notify: z.boolean().optional().default(false),
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

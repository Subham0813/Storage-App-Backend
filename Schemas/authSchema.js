import mongoose from "mongoose";
import { z } from "zod/v4";

export const nameSchema = z
  .string()
  .min(3, { message: "Name must be between 3 and 100 characters long" })
  .max(100, { message: "Name must be between 3 and 100 characters long" })
  .regex(/^[a-zA-Z]+( [a-zA-Z]+)*$/, {
    message: "Name must contain exactly one space between words",
  });

export const emailSchema = z.email({
  message: "Please enter a valid email address",
});

export const passwordSchema = z
  .string()
  .min(8)
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
    {
      message:
        "Password must contain at least one uppercase letter, one lowercase letter, one number, one symbol and at least 8 characters long",
    },
  );

export const purposeSchema = z.enum(["login", "register", "forgot-password"], {
  message: "Purpose must be either login/register/forgot-password",
});

export const loginSchema = z.object({
  email: emailSchema.toLowerCase().trim(),
  password: passwordSchema,
});

export const registerSchema = loginSchema.extend({
  name: nameSchema,
});

export const requestOtpSchema = z.object({
  email: loginSchema.shape.email,
  purpose: purposeSchema,
});

export const verifyOtpSchema = z.object({
  email: loginSchema.shape.email,
  otp: z
    .string()
    .refine((val) => !isNaN(val), {
      message: "OTP must contain only numbers",
    })
    .length(6, {
      message: "OTP must be 6 digits long",
    }),
  logoutLastSession: z
    .boolean({
      message: "logoutLastSession must be a boolean value",
    })
    .optional(),
});

export const authTokenSchema = z.object({
  id: z.string().refine((val) => mongoose.isValidObjectId(val), {
    message: "Invalid id",
  }),
  purpose: requestOtpSchema.shape.purpose,
  // expires: z.number().refine((val) => val > Date.now()),
});

export const changePasswordSchema = z
  .object({
    oldPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .refine((data) => data.newPassword === data.oldPassword, {
    message: "Old and New passwords can't be same",
    path: ["newPassword"],
  });

export const feedbackSchema = z.object({
  category: z.enum([
    "upload",
    "preview",
    "sharing",
    "billing",
    "performance",
    "other",
  ]),
  title: z
    .string()
    .min(5, { message: "Title must be at least 5 characters." })
    .max(200, { message: "Title cannot exceed 200 characters." })
    .trim(),
  description: z
    .string()
    .min(10, { message: "Description must be at least 10 characters." })
    .max(2000, { message: "Description cannot exceed 2000 characters." })
    .trim(),
  screenshotBase64: z.string().optional(),
});

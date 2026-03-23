import mongoose from "mongoose";
import { z } from "zod/v4";

const nameSchema = z
  .string()
  .min(3, { message: "Name must be between 3 and 100 characters long." })
  .max(100, { message: "Name must be between 3 and 100 characters long." })
  .regex(/^[a-zA-Z]+ [a-zA-Z]+$/, {
    message: "Name must contain exactly one space between words.",
  });
const emailSchema = z.email({
  message: "Please enter a valid email address.",
});
const passwordSchema = z
  .string()
  .min(8)
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
    {
      message:
        "Password must contain at least one uppercase letter, one lowercase letter, one number, one symbol and at least 8 characters long.",
    },
  );
const purposeSchema = z.enum(["login", "register", "forgot-password"], {
  message: "Purpose must be either login/register/forgot-password.",
});

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const registerSchema = loginSchema.extend({
  fullname: nameSchema,
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
      message: "OTP must contain only numbers.",
    })
    .length(6, {
      message: "OTP must be 6 digits long.",
    }),
  logoutLastSession: z
    .boolean({
      message: "logoutLastSession must be a boolean value.",
    })
    .optional(),
});

export const authTokenSchema = z.object({
  id: z.string().refine((val) => mongoose.isValidObjectId(val), {
    message: "Invalid id.",
  }),
  purpose: requestOtpSchema.shape.purpose,
  expires: z.number().refine((val) => val > Date.now()),
});

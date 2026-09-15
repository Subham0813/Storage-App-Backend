import connectMongoose from "../configs/connect.js";

const mongoose = await connectMongoose();
const client = mongoose.connection.getClient();
const db = mongoose.connection.db;

// const command = "create";
const command = "collMod";

/**
 * 1. USERS COLLECTION
 */
await db.command({
  [command]: "users",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["authProviders", "name", "email"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for the user record.",
        },
        root: {
          bsonType: ["objectId"],
          description: "Reference to the user's root directory.",
        },
        integrations: {
          bsonType: ["object", "null"],
          properties: {
            googleDrive: {
              bsonType: "object",
              properties: {
                accessToken: { bsonType: ["string", "null"] },
                refreshToken: { bsonType: ["string", "null"] },
                scope: { bsonType: ["string", "null"] },
                idToken: { bsonType: ["string", "null"] },
                expiryDate: { bsonType: ["date", "null"] },
                tokenExpiry: { bsonType: ["date", "null"] },
              },
            },
            //for future updates
            // github: {
            //   bsonType: "object",
            //   properties: {
            //     accessToken: { bsonType: ["string", "null"] },
            //     refreshToken: { bsonType: ["string", "null"] },
            //     tokenExpiry: { bsonType: ["date", "null"] },
            //   },
            // },
            // dropbox: {
            //   bsonType: "object",
            //   properties: {
            //     accessToken: { bsonType: ["string", "null"] },
            //     refreshToken: { bsonType: ["string", "null"] },
            //     tokenExpiry: { bsonType: ["date", "null"] },
            //   },
            // },
            // onedrive: {
            //   bsonType: "object",
            //   properties: {
            //     accessToken: { bsonType: ["string", "null"] },
            //     refreshToken: { bsonType: ["string", "null"] },
            //     tokenExpiry: { bsonType: ["date", "null"] },
            //   },
            // },
          },
        },
        name: {
          bsonType: "string",
          minLength: 3,
          maxLength: 50,
          pattern:
            "^(?!\\s*(?:undefined|null|na|n\\/a|none|unknown|test)\\s*$)[A-Za-z ]{3,50}$",
          description:
            "Full name of the user; must not be a placeholder value.",
        },
        email: {
          bsonType: "string",
          description: "Unique email address for user identification.",
        },
        password: {
          bsonType: ["string", "null"],
          minLength: 8,
          description: "Hashed user password.",
        },
        googleId: {
          bsonType: ["string", "null"],
          description: "Unique ID from Google OAuth integration.",
        },
        githubId: {
          bsonType: ["string", "null"],
          description: "Unique ID from GitHub OAuth integration.",
        },
        authProviders: {
          bsonType: "array",
          items: {
            bsonType: "string",
            enum: ["email", "google", "github"],
          },
          description: "List of authentication methods used by the account.",
        },
        role: {
          bsonType: "string",
          enum: ["super_admin", "admin", "manager", "user"],
          description: "Role assigned to the user.",
        },
        plan: {
          bsonType: "string",
          enum: [
            "FREE",
            "PRO_MONTHLY",
            "PRO_YEARLY",
            "BUSINESS_MONTHLY",
            "BUSINESS_YEARLY",
          ],
          description: "User subscription plan.",
        },
        subscription: {
          bsonType: "objectId",
          description: "User subscription id.",
        },
        subscriptionExpiresAt: {
          bsonType: ["date", "null"],
          description: "Timestamp of subscription expiry.",
        },
        isTwoFactorEnabled: {
          bsonType: "bool",
          description: "Flag for two-factor authentication.",
        },
        twoFactorSecret: {
          bsonType: "string",
          description: "Encrypted 2FA secret.",
        },
        avatarKey: {
          bsonType: "string",
          description: "S3 object key of the user avatar.",
        },
        maxQuota: {
          bsonType: ["int", "long", "double", "null"],
          minimum: 0,
          description: "Maximum storage quota in bytes.",
        },
        usedBandwidthQuota: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Bandwidth used in the current cycle.",
        },
        maxBandwidthQuota: {
          bsonType: ["int", "long", "double", "null"],
          minimum: 0,
          description: "Maximum bandwidth quota in bytes.",
        },
        bandwidthResetAt: {
          bsonType: "date",
          description: "Timestamp of bandwidth quota reset.",
        },
        isEmailVerified: {
          bsonType: "bool",
          description: "Flag indicating whether the user email is verified.",
        },
        isLogged: {
          bsonType: "bool",
          description:
            "Flag indicating whether the user is currently logged in.",
        },
        isActive: {
          bsonType: "bool",
          description: "Flag indicating whether the user account is active.",
        },
        lastLogin: {
          bsonType: "date",
          description: "Timestamp of the last login.",
        },
        lastActiveAt: {
          bsonType: "date",
          description: "Timestamp of the last activity.",
        },
        isDeleted: {
          bsonType: "bool",
          description: "Flag for soft deletion.",
        },
        deletedAt: {
          bsonType: "date",
          description: "Timestamp of deletion.",
        },
        deletedBy: {
          bsonType: "objectId",
          description: "User who triggered the deletion.",
        },
        gracePeriodEndsAt: {
          bsonType: ["date", "null"],
          description: "Timestamp when the grace period ends.",
        },
        createdAt: {
          bsonType: "date",
          description: "Timestamp of user creation.",
        },
        updatedAt: {
          bsonType: "date",
          description: "Timestamp of last update.",
        },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

/**
 * 2. USER_FILES COLLECTION
 */
await db.command({
  [command]: "userfiles",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "userId",
        "parentId",
        "name",
        "extension",
        "mime",
        "size",
        "isStarred",
        "isDeleted",
      ],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for this file reference.",
        },
        type: {
          bsonType: "string",
          description: "Resource type discriminator (file).",
        },
        path: {
          bsonType: "array",
          items: {
            bsonType: "objectId",
          },
          description: "Array of ancestor directory IDs.",
        },
        userId: {
          bsonType: "objectId",
          description: "User owning this file reference.",
        },
        parentId: {
          bsonType: "objectId",
          description: "Folder containing this file.",
        },
        key: {
          bsonType: "string",
          description: "S3 object key for the file.",
        },
        versionId: {
          bsonType: "string",
          description: "S3 object version id for the file.",
        },
        thumbnailKey: {
          bsonType: "string",
          description: "S3 object key for the thumbnail.",
        },
        thumbId: {
          bsonType: "string",
          description: "S3 object version id for the thumbnail.",
        },
        webviewLink: {
          bsonType: ["string", "null"],
          description: "Web view link for the file (e.g., Google Drive).",
        },
        name: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
          description: "Display name of the file.",
        },
        extension: {
          bsonType: "string",
          description: "File extension.",
        },
        mime: {
          bsonType: "string",
          minLength: 1,
          description: "MIME type for browser identification.",
        },
        size: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "File size in bytes.",
        },
        isStarred: {
          bsonType: "bool",
          description: "Flag for user favorites.",
        },
        isDeleted: {
          bsonType: "bool",
          description: "Flag for soft deletion/Trash bin.",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
          description: "Entity that deleted the file.",
        },
        deletedAt: {
          bsonType: ["date", "null"],
          description: "Time of deletion for TTL purposes.",
        },
        permanentDeleteAt: {
          bsonType: ["date", "null"],
          description: "Time after which the file is permanently deleted.",
        },
        publicRole: {
          bsonType: "string",
          enum: ["view", "none"],
          description: "Public access role.",
        },
        publicBy: {
          bsonType: "objectId",
          description: "User who made the item public.",
        },
        sharedAt: {
          bsonType: ["date", "null"],
          description: "Share creation time.",
        },
        shareToken: {
          bsonType: ["string", "null"],
          description: "Public share token.",
        },
        shareLink: {
          bsonType: "string",
          description: "Generated public share link.",
        },
        shareTokenExpiresAt: {
          bsonType: ["date", "null"],
          description: "Public link expiration timestamp.",
        },
        accessCount: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Number of times the file was accessed.",
        },
        accessLevel: {
          bsonType: "string",
          enum: ["private", "shared", "public"],
          description: "Access level of the file.",
        },
        lastAccessedAt: {
          bsonType: "date",
          description: "Timestamp of last access.",
        },
        lastModifiedBy: {
          bsonType: "objectId",
          description: "User who last modified the file.",
        },
        createdAt: { bsonType: "date", description: "Creation timestamp." },
        updatedAt: { bsonType: "date", description: "Update timestamp." },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

/**
 * 3. DIRECTORIES COLLECTION
 */
await db.command({
  [command]: "directories",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "userId", "parentId", "isStarred", "isDeleted"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique directory identifier.",
        },
        type: {
          bsonType: "string",
          description: "Resource type discriminator (directory).",
        },
        name: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
          pattern: '^[^\\\\\\/:*?"<>|]+$',
          description:
            "Folder name; restricted characters for file system compatibility.",
        },
        parentId: {
          bsonType: ["objectId", "null"],
          description: "Parent directory ID.",
        },
        userId: {
          bsonType: "objectId",
          description: "Owner of the directory.",
        },
        path: {
          bsonType: "array",
          items: {
            bsonType: "objectId",
          },
          description: "Array of ancestor directory IDs.",
        },
        size: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Cumulative size of folder contents.",
        },
        color: {
          bsonType: "string",
          description: "Folder color label.",
        },
        isStarred: {
          bsonType: "bool",
          description: "Flag for favorites.",
        },
        isDeleted: {
          bsonType: "bool",
          description: "Flag for soft deletion.",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
          description: "Entity that deleted the directory.",
        },
        deletedAt: {
          bsonType: ["date", "null"],
          description: "Time of deletion for TTL purposes.",
        },
        permanentDeleteAt: {
          bsonType: ["date", "null"],
          description: "Time after which the directory is permanently deleted.",
        },
        publicRole: {
          bsonType: "string",
          enum: ["view", "none"],
          description: "Public access role.",
        },
        publicBy: {
          bsonType: "objectId",
          description: "User who made the item public.",
        },
        sharedAt: {
          bsonType: ["date", "null"],
          description: "Share creation time.",
        },
        shareToken: {
          bsonType: ["string", "null"],
          description: "Public share token.",
        },
        shareLink: {
          bsonType: "string",
          description: "Generated public share link.",
        },
        shareTokenExpiresAt: {
          bsonType: ["date", "null"],
          description: "Public link expiration timestamp.",
        },
        accessCount: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Number of times the directory was accessed.",
        },
        accessLevel: {
          bsonType: "string",
          enum: ["private", "shared", "public"],
          description: "Access level of the directory.",
        },
        lastAccessedAt: {
          bsonType: "date",
          description: "Timestamp of last access.",
        },
        lastModifiedBy: {
          bsonType: "objectId",
          description: "User who last modified the directory.",
        },
        createdAt: { bsonType: "date", description: "Creation timestamp." },
        updatedAt: { bsonType: "date", description: "Update timestamp." },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

/**
 * 4. PERMISSIONS COLLECTION
 */
await db.command({
  [command]: "permissions",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "itemId", "onModel", "grantedBy"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for this permission record.",
        },
        userId: {
          bsonType: "objectId",
          description: "User who has been granted access.",
        },
        itemId: {
          bsonType: "objectId",
          description: "File or Directory ID that is being shared.",
        },
        onModel: {
          bsonType: "string",
          enum: ["Directory", "UserFile"],
          description: "Type of item being shared.",
        },
        permission: {
          bsonType: "string",
          enum: ["view", "edit"],
          description: "Permission level granted to the user.",
        },
        grantedBy: {
          bsonType: "objectId",
          description: "User who granted this permission.",
        },
        createdAt: { bsonType: "date", description: "Creation timestamp." },
        updatedAt: { bsonType: "date", description: "Update timestamp." },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

/**
 * 5. SUBSCRIPTIONS COLLECTION
 */
await db.command({
  [command]: "subscriptions",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "user",
        "razorpaySubscriptionId",
        "planId",
        "planKey",
        "price",
      ],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for this subscription record.",
        },
        user: {
          bsonType: "objectId",
          description: "User owning this subscription.",
        },
        razorpaySubscriptionId: {
          bsonType: "string",
          description: "Razorpay subscription ID.",
        },
        planId: {
          bsonType: "string",
          description: "Razorpay plan ID.",
        },
        planKey: {
          bsonType: "string",
          enum: [
            "PRO_MONTHLY",
            "PRO_YEARLY",
            "BUSINESS_MONTHLY",
            "BUSINESS_YEARLY",
          ],
          description: "Plan key used for feature resolution.",
        },
        status: {
          bsonType: "string",
          description: "Razorpay subscription status.",
        },
        price: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Plan price.",
        },
        paidCount: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Number of successful payments.",
        },
        shortUrl: {
          bsonType: "string",
          description: "Razorpay checkout short URL.",
        },
        invoiceUrl: {
          bsonType: "string",
          description: "Latest invoice URL.",
        },
        currentPeriodStart: {
          bsonType: "date",
          description: "Start of the current billing period.",
        },
        currentPeriodEnd: {
          bsonType: "date",
          description: "End of the current billing period.",
        },
        endedAt: {
          bsonType: "date",
          description: "Timestamp when the subscription ended.",
        },
        cancelAtPeriodEnd: {
          bsonType: "bool",
          description: "Whether subscription cancels at period end.",
        },
        cancelReason: {
          bsonType: "string",
          description: "Reason the subscription was cancelled.",
        },
        limits: {
          bsonType: "object",
          required: [
            "quotaBytes",
            "maxFileSize",
            "chunkSize",
            "monthlyBandwidthLimit",
            "maxUploadConcurrency",
            "maxDevices",
            "canCreatePublicLinks",
            "trashRetentionDays",
            "gracePeriod",
          ],
          additionalProperties: false,
          properties: {
            quotaBytes: {
              bsonType: ["int", "long", "double"],
              minimum: 0,
              description: "Storage quota in bytes.",
            },
            maxFileSize: {
              bsonType: ["int", "long", "double"],
              minimum: 0,
              description: "Maximum single file size in bytes.",
            },
            chunkSize: {
              bsonType: ["int", "long", "double"],
              minimum: 0,
              description: "Upload chunk size in bytes.",
            },
            monthlyBandwidthLimit: {
              bsonType: ["int", "long", "double"],
              minimum: 0,
              description: "Monthly bandwidth limit in bytes.",
            },
            maxUploadConcurrency: {
              bsonType: ["int", "long", "double"],
              minimum: 1,
              description: "Maximum concurrent uploads.",
            },
            maxDevices: {
              bsonType: ["int", "long", "double"],
              minimum: 1,
              description: "Maximum connected devices.",
            },
            canCreatePublicLinks: {
              bsonType: "bool",
              description: "Whether public link sharing is allowed.",
            },
            trashRetentionDays: {
              bsonType: ["int", "long", "double"],
              minimum: 0,
              description: "Days items stay in trash.",
            },
            gracePeriod: {
              bsonType: ["int", "long", "double"],
              minimum: 0,
              description: "Grace period in days.",
            },
          },
        },
        createdAt: { bsonType: "date", description: "Creation timestamp." },
        updatedAt: { bsonType: "date", description: "Update timestamp." },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

/**
 * 6. NOTIFICATIONS COLLECTION
 */
await db.command({
  [command]: "notifications",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "type", "title", "message"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for this notification.",
        },
        userId: {
          bsonType: "objectId",
          description: "User who receives the notification.",
        },
        type: {
          bsonType: "string",
          enum: ["share", "system", "storage_warning"],
          description: "Notification type.",
        },
        title: {
          bsonType: "string",
          description: "Short notification title.",
        },
        message: {
          bsonType: "string",
          description: "Notification body message.",
        },
        read: {
          bsonType: "bool",
          description: "Whether the notification has been read.",
        },
        link: {
          bsonType: "string",
          description: "Optional deep link for the notification.",
        },
        createdAt: { bsonType: "date", description: "Creation timestamp." },
        updatedAt: { bsonType: "date", description: "Update timestamp." },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

/**
 * 7. FEEDBACKS COLLECTION
 */
await db.command({
  [command]: "feedbacks",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "category", "title", "description"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for this feedback record.",
        },
        userId: {
          bsonType: "objectId",
          description: "User who submitted the feedback.",
        },
        category: {
          bsonType: "string",
          enum: [
            "upload",
            "preview",
            "sharing",
            "billing",
            "performance",
            "other",
          ],
          description: "Feedback category.",
        },
        title: {
          bsonType: "string",
          minLength: 5,
          maxLength: 200,
          description: "Feedback title.",
        },
        description: {
          bsonType: "string",
          minLength: 10,
          maxLength: 2000,
          description: "Feedback description.",
        },
        screenshotKey: {
          bsonType: ["string", "null"],
          description: "Optional screenshot attached to the feedback.",
        },
        status: {
          bsonType: "string",
          enum: ["pending", "reviewed", "resolved"],
          description: "Admin review status.",
        },
        adminNotes: {
          bsonType: ["string", "null"],
          description: "Admin notes on the feedback.",
        },
        createdAt: { bsonType: "date", description: "Creation timestamp." },
        updatedAt: { bsonType: "date", description: "Update timestamp." },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await client.close();
console.info(
  "Database validation script completed and client closed successfully.",
);

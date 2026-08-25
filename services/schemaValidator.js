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
          bsonType: "object",
          properties: {
            googleDrive: {
              bsonType: "object",
              properties: {
                accessToken: { bsonType: ["string", "null"] },
                refreshToken: { bsonType: ["string", "null"] },
                scope: { bsonType: ["string", "null"] },
                tokenType: { bsonType: ["string", "null"] },
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
            "^(?!\\s*(?:undefined|null|na|n/a|none|unknown|test)\\s*$)[A-Za-z ]{3,50}$",
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
        maxQuota: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Maximum storage quota in bytes.",
        },
        subscription: {
          bsonType: "objectId",
          description: "User subscription id.",
        },
        subscriptionExpiresAt: {
          bsonType: "date",
          description: "Timestamp of subscription expiry.",
        },
        isDeleted: {
          bsonType: "bool",
          description: "Flag for soft deletion.",
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
  validationLevel: "warn",
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
        "mime",
        "size",
        "isStarred",
        "isDeleted",
        "deletedBy",
      ],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for this file reference.",
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
        publicRole: {
          bsonType: "object",
          properties: {
            role: {
              bsonType: "string",
              enum: ["view", "none"],
              description: "Public access role.",
            },
            sharedAt: {
              bsonType: ["date", "null"],
              description: "Share creation time.",
            },
            shareToken: {
              bsonType: ["string", "null"],
              description: "Public share token.",
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
  validationLevel: "warn",
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
      required: ["name", "userId", "parentId", "isDeleted", "deletedBy"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique directory identifier.",
        },
        name: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
          pattern: '^[^\\\\\/:*?"<>|]+$',
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
        isDeleted: {
          bsonType: "bool",
          description: "Flag for soft deletion.",
        },
        isStarred: {
          bsonType: "bool",
          description: "Flag for favorites.",
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
        publicRole: {
          bsonType: "object",
          properties: {
            role: {
              bsonType: "string",
              enum: ["view", "none"],
              description: "Public access role.",
            },
            sharedAt: {
              bsonType: ["date", "null"],
              description: "Share creation time.",
            },
            shareToken: {
              bsonType: ["string", "null"],
              description: "Public share token.",
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
  validationLevel: "warn",
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
  validationLevel: "warn",
  validationAction: "error",
});

await client.close();
console.info(
  "Database validation script completed and client closed successfully.",
);

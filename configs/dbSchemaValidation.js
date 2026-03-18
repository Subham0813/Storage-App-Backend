import connectMongoose from "./connect.js";

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
      required: ["username", "authProviders"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for the user record.",
        },
        root: {
          bsonType: "objectId",
          description: "Reference to the user's root directory.",
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
          bsonType: ["string", "null"],
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
          description: "Unique email address for user identification.",
        },
        isEmailVerified: {
          bsonType: "bool",
          description: "Flag indicating if the user's email is verified.",
        },
        password: {
          bsonType: "string",
          minLength: 8,
          description: "Hashed user password.",
        },
        username: {
          bsonType: "string",
          description: "Unique handle for the user.",
        },
        avatar: {
          bsonType: "string",
          description: "Path or URL to the user's profile image.",
        },
        googleId: {
          bsonType: "string",
          description: "Unique ID from Google OAuth integration.",
        },
        githubId: {
          bsonType: "string",
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
          enum: ["SUPER_ADMIN", "ADMIN", "GUEST", "USER"],
          description: "Role assigned to the user.",
        },
        theme: {
          bsonType: "string",
          description: "Preferred UI theme (e.g., Light/Dark).",
        },
        deviceCount: {
          bsonType: "int",
          minimum: 0,
          description: "Number of devices linked to this user.",
        },
        allotedStorage: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Total storage capacity in bytes.",
        },
        usedStorage: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Currently consumed storage in bytes.",
        },

        isDeleted: {
          bsonType: "bool",
          description: "Flag for soft deletion/Trash bin.",
        },
        isLogged: {
          bsonType: "bool",
          description: "Flag for user logged or not.",
        },
        deletedAt: {
          bsonType: "date",
          description: "Timestamp of user deletion.",
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
 * 2. FILES COLLECTION (Global Unique Metadata)
 */
await db.command({
  [command]: "files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "userId",
        "hash",
        "hashAlgo",
        "detectedMime",
        "size",
        "refCount",
        "storageProvider",
        "createdAt",
        "objectKey",
      ],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique file metadata identifier.",
        },
        userId: {
          bsonType: "objectId",
          description: "Owner who uploaded the physical file.",
        },
        hash: {
          bsonType: "string",
          description: "Content-based hash for deduplication.",
        },
        hashAlgo: {
          bsonType: "string",
          enum: ["sha256"],
          description: "Algorithm used for hashing.",
        },
        storageProvider: {
          bsonType: "string",
          enum: ["local", "s3", "r2", "gcs"],
          description: "Storage backend used.",
        },
        detectedMime: {
          bsonType: "string",
          description: "Detected file type.",
        },
        objectKey: {
          bsonType: "string",
          description: "Path or key in the storage provider.",
        },
        size: {
          bsonType: ["int", "double", "long"],
          minimum: 0,
          description: "Physical file size in bytes.",
        },
        refCount: {
          bsonType: ["int", "long"],
          minimum: 0,
          description: "Number of references from user files.",
        },
        createdAt: {
          bsonType: "date",
          description: "Timestamp of first upload.",
        },
        updatedAt: {
          bsonType: "date",
          description: "Timestamp of last reference update.",
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
 * 3. USER_FILES COLLECTION (Individual File Pointers)
 */
await db.command({
  [command]: "user_files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "userId",
        "parentId",
        "meta",
        "filename",
        "mimetype",
        "disposition",
        "size",
        "inline_preview",
        "force_inline_preview",
        "isDeleted",
        "isStarred",
        "deletedBy",
        "sharedWith",
        "createdAt",
      ],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique identifier for this file reference.",
        },
        userId: {
          bsonType: "objectId",
          description: "User owning this file reference.",
        },
        parentId: {
          bsonType: "objectId",
          description: "Folder containing this file.",
        },
        meta: {
          bsonType: ["null", "objectId"],
          description: "Link to the shared physical file metadata.",
        },
        linkMeta: {
          bsonType: "object",
        },
        filename: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
          description: "Display name of the file.",
        },
        mimetype: {
          bsonType: "string",
          minLength: 1,
          description: "MIME type for browser identification.",
        },
        disposition: {
          bsonType: "string",
          enum: ["inline", "attachment"],
          description: "How the browser should handle the file.",
        },
        size: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Display size in bytes.",
        },
        inline_preview: {
          bsonType: "bool",
          description: "Whether an inline preview is available.",
        },
        force_inline_preview: {
          bsonType: "bool",
          description: "Flag to force browser-side preview.",
        },
        isDeleted: {
          bsonType: "bool",
          description: "Flag for soft deletion/Trash bin.",
        },
        isStarred: {
          bsonType: "bool",
          description: "Flag for user favorites.",
        },
        publicRole: {
          bsonType: "string",
          enum: ["VIEWER", "NONE"],
          description: "Permissions for general audience",
        },
        sharedAt: {
          bsonType: ["null", "date"],
          description: "Share creation time.",
        },
        shareToken: { bsonType: ["null", "string"] },
        sharedWith: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["email", "role"],
            properties: {
              email: { bsonType: "string", description: "Recipient email." },
              role: {
                bsonType: "string",
                enum: ["VIEWER", "EDITOR"],
                description: "Permission roles.",
              },
            },
          },
          description: "List of collaboration permissions.",
        },
        sharedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
          description: "Entity that deleted the file.",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
          description: "Entity that deleted the file.",
        },
        deletedAt: {
          bsonType: ["null", "date"],
          description: "Time of deletion for TTL purposes.",
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
 * 4. DIRECTORIES COLLECTION
 */
await db.command({
  [command]: "directories",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["dirname", "userId", "parentId", "isDeleted", "createdAt"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique directory identifier.",
        },
        dirname: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
          pattern: '^[^\\\\/:*?"<>|]+$',
          description:
            "Folder name; restricted characters for file system compatibility.",
        },
        parentId: { bsonType: "objectId", description: "Parent directory ID." },
        userId: {
          bsonType: "objectId",
          description: "Owner of the directory.",
        },
        size: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Cumulative size of folder contents.",
        },
        isDeleted: { bsonType: "bool", description: "Flag for soft deletion." },
        isStarred: { bsonType: "bool", description: "Flag for favorites." },
        publicRole: {
          bsonType: "string",
          enum: ["VIEWER", "NONE"],
          description: "Permissions for general audience",
        },
        sharedAt: {
          bsonType: ["null", "date"],
          description: "Share creation time.",
        },
        shareToken: { bsonType: ["null", "string"] },
        sharedWith: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["email", "role"],
            properties: {
              email: { bsonType: "string", description: "Recipient email." },
              role: {
                bsonType: "string",
                enum: ["VIEWER", "EDITOR"],
                description: "Permission roles.",
              },
            },
          },
          description: "List of collaboration permissions.",
        },
        sharedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
          description: "Entity that deleted the file.",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
          description: "Entity that deleted the file.",
        },
        deletedAt: {
          bsonType: ["null", "date"],
          description: "Time of deletion for TTL purposes.",
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
 * 5. SESSIONS COLLECTION
 */
await db.command({
  [command]: "sessions",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "createdAt"],
      properties: {
        _id: {
          bsonType: "objectId",
          description: "Unique session identifier.",
        },
        userId: { bsonType: "objectId", description: "Owner of the session." },
        expiry: { bsonType: "string", description: "Expiration date string." },
        createdAt: {
          bsonType: "date",
          description: "Creation time used for TTL.",
        },
        updatedAt: {
          bsonType: "date",
          description: "Last session activity timestamp.",
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
 * 6. OTPS COLLECTION
 */
await db.command({
  [command]: "otps",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "email", "otp", "purpose", "createdAt"],
      properties: {
        _id: { bsonType: "objectId", description: "Unique OTP identifier." },
        userId: {
          bsonType: "objectId",
          description: "Owner who uploaded the physical file.",
        },
        email: {
          bsonType: "string",
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$",
          description: "Email address associated with the OTP.",
        },
        purpose: {
          bsonType: "string",
          enum: ["login", "register", "forgot-password"],
          description: "Intent of the generated OTP.",
        },
        otp: { bsonType: "string", description: "Hashed/encrypted OTP value." },
        isVerified: {
          bsonType: "bool",
          description: "Flag indicating if the OTP has been used.",
        },
        createdAt: {
          bsonType: "date",
          description: "Time of generation (TTL 300s).",
        },
        updatedAt: {
          bsonType: "date",
          description: "Timestamp of last verification status update.",
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
 * 7. UPLOAD SESSIONS COLLECTION
 */
await db.command({
  [command]: "upload_sessions",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "userId",
        "parentId",
        "filename",
        "size",
        "strategy",
        "status",
        "mime",
        "chunkSize",
        "totalChunks",
      ],
      properties: {
        _id: { bsonType: "objectId", description: "Unique upload session ID." },
        userId: {
          bsonType: "objectId",
          description: "User initiating the upload.",
        },
        filename: {
          bsonType: "string",
          description: "Name of the file being uploaded.",
        },
        size: {
          bsonType: ["int", "long", "double"],
          minimum: 0,
          description: "Total size of the file in bytes.",
        },
        mime: { bsonType: "string", description: "File MIME type." },
        parentId: {
          bsonType: "objectId",
          description: "Target directory ID for the file.",
        },
        strategy: {
          bsonType: "string",
          enum: ["direct", "chunked", "google-drive"],
          description: "Method of upload.",
        },
        status: {
          bsonType: "string",
          enum: [
            "initiated",
            "uploading",
            "paused",
            "uploaded",
            "cancelled",
            "importing",
            "imported",
            "failed",
          ],
          description: "Current state of the upload session.",
        },
        errorMessage: { type: "string" },
        bytesRead: {
          bsonType: ["int", "long", "double"],
          description: "bytes read of individual chunks (bytes).",
        },
        chunkSize: {
          bsonType: ["int", "long", "double"],
          description: "Size of individual chunks (bytes).",
        },
        totalChunks: {
          bsonType: ["int", "long", "double"],
          description: "Total chunks expected for chunked strategy.",
        },
        uploadedChunks: {
          bsonType: "array",
          items: { bsonType: ["int", "long", "double"] },
          description: "Indices of chunks successfully uploaded.",
        },
        tempDir: {
          bsonType: "string",
          description: "Temporary storage path on the server.",
        },
        expiresAt: {
          bsonType: ["date", "null"],
          description: "TTL expiration timestamp.",
        },
        createdAt: { bsonType: "date", description: "Creation timestamp." },
        updatedAt: {
          bsonType: "date",
          description: "Last progress update timestamp.",
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
 * 8. DRIVE INTEGRATIONS COLLECTION
 */
await db.command({
  [command]: "drive_integrations",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "provider", "scope"],
      properties: {
        _id: { bsonType: "objectId", description: "Unique integration ID." },
        userId: {
          bsonType: "objectId",
          description: "Local user ID linked to this integration.",
        },
        state: { bsonType: "string", description: "CSRF state token." },
        stateCreatedAt: {
          bsonType: "date",
          description: "Timestamp when state was generated (TTL 0).",
        },
        provider: {
          bsonType: "string",
          enum: ["google-drive"],
          description: "OAuth provider name.",
        },
        accessToken: {
          bsonType: "string",
          description: "Active OAuth access token.",
        },
        refreshToken: {
          bsonType: "string",
          description: "Token used to refresh access.",
        },
        scope: {
          bsonType: "array",
          items: { bsonType: "string" },
          description: "List of scopes granted by the provider.",
        },
        connectedAt: {
          bsonType: "date",
          description: "Timestamp of successful connection.",
        },
        expiresIn: {
          bsonType: "date",
          description: "Timestamp when the access token will expire.",
        },
        createdAt: {
          bsonType: "date",
          description: "Metadata creation timestamp.",
        },
        updatedAt: {
          bsonType: "date",
          description: "Metadata update timestamp.",
        },
        __v: { bsonType: "int", description: "Mongoose versioning key." },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await client.close();
console.log(
  "Database validation script completed and client closed successfully.",
);

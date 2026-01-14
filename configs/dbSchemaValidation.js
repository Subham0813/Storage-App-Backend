//dbSchema & validations
import connectMongoose from "./connect.js";

const mongoose = await connectMongoose();
const client = mongoose.connection.getClient();
const db = mongoose.connection.db;

const command = "collMod";

await db.command({
  [command]: "users",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["fullname", "email", "password"],
      properties: {
        _id: { bsonType: "objectId" },

        fullname: {
          bsonType: "string",
          minLength: 3,
          maxLength: 100,
          pattern:
            "^(?!s*(?:undefined|null|na|n/a|none|unknown|test)s*$)[A-Za-z ]{3,100}$",
        },

        email: {
          bsonType: "string",
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$",
        },

        password: { bsonType: "string", minLength: 8 },

        username: { bsonType: "string" },

        deviceCount: { bsonType: "int", minimum: 0 },
        
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        __v: { bsonType: "int" },
      },

      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

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
        _id: { bsonType: "objectId" },

        userId: { bsonType: "objectId" },

        hash: {
          bsonType: "string",
          // pattern: "^[a-f0-9]{43}$",
        },

        hashAlgo: {
          bsonType: "string",
          enum: ["sha256"],
        },

        storageProvider: {
          bsonType: "string",
          enum: ["local", "s3", "r2", "gcs"],
        },

        detectedMime: { bsonType: "string", minLength: 1 },

        objectKey: { bsonType: "string" },

        size: { bsonType: ["int", "double", "long"], minimum: 1 },

        refCount: {
          bsonType: ["int", "long"],
          minimum: 0,
        },

        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        __v: { bsonType: "int" },
      },

      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await db.command({
  [command]: "user_files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "userId",
        "parentId",
        "meta",
        "name",
        "mimetype",
        "disposition",
        "isDeleted",
        "deletedBy",
        "deletedAt",
        "createdAt",
      ],
      properties: {
        _id: { bsonType: "objectId" },

        userId: { bsonType: "objectId" },

        parentId: { bsonType: ["null", "objectId"] },

        meta: { bsonType: "objectId" },

        name: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
        },

        mimetype: { bsonType: "string", minLength: 1 },

        disposition: { bsonType: "string", enum: ["inline", "attachment"] },

        inline_preview: { bsonType: "bool" },
        force_inline_preview: { bsonType: "bool" },

        isDeleted: { bsonType: "bool" },

        deletedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
        },

        deletedAt: { bsonType: ["null", "date"] },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        __v: { bsonType: "int" },
      },

      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await db.command({
  [command]: "directories",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "userId", "isDeleted", "createdAt"],
      properties: {
        _id: { bsonType: "objectId" },

        name: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
          pattern: '^[^\\\\/:*?"<>|]+$',
        },

        parentId: { bsonType: ["null", "objectId"] },

        userId: { bsonType: "objectId" },

        isDeleted: { bsonType: "bool" },

        deletedBy: {
          bsonType: "string",
          enum: ["none", "user", "process"],
        },

        deletedAt: { bsonType: ["null", "date"] },

        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        __v: { bsonType: "int" },
      },

      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await db.command({
  [command]: "sessions",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "createdAt"],
      properties: {
        _id: { bsonType: "objectId" },
        userId: { bsonType: "objectId" },
        expiry: { bsonType: "string" },

        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        __v: { bsonType: "int" },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await db.command({
  [command]: "otps",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "otp", "purpose", "createdAt"],
      properties: {
        _id: { bsonType: "objectId" },
        email: {
          bsonType: "string",
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$",
        },

        purpose: {
          bsonType: "string",
          enum: ["login", "register", "forgotPassword"],
        },

        otp: { bsonType: "string" },
        isVerified: { bsonType: "bool" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        __v: { bsonType: "int" },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});
await client.close();
console.log("client closed successfully");

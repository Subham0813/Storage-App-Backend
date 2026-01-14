//dbSchema & validations
import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://127.0.0.1:27017/StorageApp");

await client.connect();
const db = client.db();

await db.command({
  collMod: "users",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["fullname", "email", "password"],
      properties: {
        _id: { bsonType: "objectId" },

        fullname: {
          bsonType: "string",
          minLength: 3,
          maxLength: 50,
        },

        email: {
          bsonType: "string",
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
        },

        password: { bsonType: "string", minLength: 8 },

        username: { bsonType: "string" },

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
  collMod: "files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "createdAt",
        "detectedMime",
        "filename",
        "isDeleted",
        "objectKey",
        "originalname",
        "size",
        "storageProvider",
        "userId",
      ],
      properties: {
        _id: { bsonType: "objectId" },

        userId: { bsonType: "objectId" },

        parentId: { bsonType: ["null", "objectId"] },

        originalname: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
        },

        filename: {
          bsonType: "string",
          pattern:
            "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        },

        objectKey: {
          bsonType: "string",
          pattern:
            "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        },

        storageProvider: {
          bsonType: "string",
          enum: ["local", "s3", "r2", "gcs"],
        },

        mimetype: { bsonType: "string", minLength: 3 },

        detectedMime: { bsonType: "string", minLength: 3 },

        disposition: { bsonType: "string", enum: ["inline", "attachment"] },

        size: { bsonType: ["int", "long", "double"], minimum: 1 },

        isDeleted: { bsonType: "bool" },

        deletedBy: {
          bsonType: "string",
          enum: ["", "user", "process"],
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
  collMod: "directories",
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
          enum: ["", "user", "process"],
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

await client.close();
console.log("client closed successfully");

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
      required: ["firstname", "lastname", "email", "password"],
      properties: {
        _id: {
          bsonType: "objectId",
        },
        firstname: {
          bsonType: "string",
          minLength: 3,
          maxLength: 20,
        },
        lastname: {
          bsonType: "string",
          minLength: 3,
          maxLength: 20,
        },
        email: {
          bsonType: "string",
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
        },
        password: {
          bsonType: "string",
          minLength: 8,
        },
        username: {
          bsonType: "string",
        },
      },
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
        "userId",
        "originalname",
        "filename",
        "objectKey",
        "storageProvider",
        "detectedMime",
        "size",
        "isDeleted",
        "createdAt",
      ],
      properties: {
        _id: {
          bsonType: "objectId",
        },
        userId: {
          bsonType: "objectId",
        },
        parentId: {
          bsonType: ["null", "objectId"],
        },
        originalname: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
        },
        filename: {
          bsonType: "string",
          pattern: "^[a-f0-9\\-]{36}$",
        },
        storageProvider: {
          bsonType: "string",
          enum: ["local", "s3", "r2", "gcs"],
        },
        objectKey: {
          bsonType: "string",
          minLength: 1,
        },
        mimetype: {
          bsonType: "string",
          minLength: 3,
        },
        detectedMime: {
          bsonType: "string",
          minLength: 3,
        },
        disposition: {
          bsonType: "string",
          enum: ["inline", "attachment"],
        },
        size: {
          bsonType: ["int", "long"],
          minimum: 1,
        },
        checksum: {
          bsonType: "string",
        },
        cdnUrl: {
          bsonType: ["null", "string"],
        },
        isDeleted: {
          bsonType: "bool",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["", "user", "process"],
        },
        deletedAt: {
          bsonType: ["null", "date"],
        },
        createdAt: {
          bsonType: "date",
        },
        modifiedAt: {
          bsonType: "date",
        },
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
        _id: {
          bsonType: "objectId",
        },
        name: {
          bsonType: "string",
          minLength: 1,
          maxLength: 255,
          pattern: '^[^\\\\/:*?"<>|]+$',
        },
        parentId: {
          bsonType: ["null", "objectId"],
        },
        ancestors: {
          bsonType: "array",
          items: {
            bsonType: ["null", "objectId"],
          },
        },
        userId: {
          bsonType: "objectId",
        },
        isDeleted: {
          bsonType: "bool",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["", "user", "process"],
        },
        deletedAt: {
          bsonType: ["null", "date"],
        },
        createdAt: {
          bsonType: "date",
        },
        modifiedAt: {
          bsonType: "date",
        },
      },
      additionalProperties: false,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await client.close();
console.log("client closed successfully");

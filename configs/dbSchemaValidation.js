//dbSchema & validations
import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://127.0.0.1:27017/StorageApp");

await client.connect();
const db = client.db();

await db.command({
  create: "users",
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
  create: "files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "userId",
        "parentId",
        "originalname",
        "parentName",
        "filename",
        "destination",
        "path",
        "encoding",
        "mimetype",
        "size",
        "isDeleted",
        "deletedBy",
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
        },
        parentName: {
          bsonType: "string",
          maxLength: 50,
        },
        filename: {
          bsonType: "string",
        },
        destination: {
          bsonType: "string",
        },
        path: {
          bsonType: "string",
        },
        encoding: {
          bsonType: "string",
        },
        mimetype: {
          bsonType: "string",
        },
        size: {
          bsonType: ["decimal", "double", "int", "long"],
        },
        isdeleted: {
          bsonType: "bool",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["", "user", "process"],
        },
      },
      additionalProperties: true,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});
await db.command({
  create: "directories",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "parentId", "parentName", "userId", "deletedBy"],
      properties: {
        _id: {
          bsonType: "objectId",
        },
        name: {
          bsonType: "string",
          minLength: 1,
          maxLength: 50,
        },
        parentId: {
          bsonType: ["null", "objectId"],
        },
        parentName: {
          bsonType: "string",
          maxLength: 50,
        },
        userId: {
          bsonType: "objectId",
        },
        deletedBy: {
          bsonType: "string",
          enum: ["", "user", "process"],
        },
      },
      additionalProperties: true,
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await client.close();

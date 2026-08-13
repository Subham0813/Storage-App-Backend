import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 1. Dynamic S3 Client Connection Blueprint
const s3ConnectionConfig = {
  region: process.env.STORAGE_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
  },
};

// Bind third-party S3 providers (MinIO, R2, B2) if custom endpoint exists
if (process.env.STORAGE_ENDPOINT) {
  s3ConnectionConfig.endpoint = process.env.STORAGE_ENDPOINT;
  s3ConnectionConfig.forcePathStyle =
    process.env.STORAGE_FORCE_PATH_STYLE === "true";
}
export const s3Client = new S3Client(s3ConnectionConfig);
export const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;

const s3PublicConnectionConfig = {
  region: process.env.PUBLIC_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.PUBLIC_ACCESS_KEY,
    secretAccessKey: process.env.PUBLIC_SECRET_KEY,
  },
};

if (process.env.PUBLIC_ENDPOINT) {
  s3PublicConnectionConfig.endpoint = process.env.PUBLIC_ENDPOINT;
}
export const s3PublicClient = new S3Client(s3PublicConnectionConfig);
export const PUBLIC_BUCKET_NAME = process.env.PUBLIC_BUCKET_NAME;


export const getStandardPresignedUrl = async (key, mime, contentLength) => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: mime,
      ...(contentLength !== undefined && { ContentLength: contentLength }),
    });
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  } catch (err) {
    throw new Error("Error generating standard presigned URL: " + err.message);
  }
};

export const getS3UploadId = async (key, mime) => {
  try {
    const command = new CreateMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: mime,
    });
    const response = await s3Client.send(command);
    return response.UploadId;
  } catch (err) {
    throw new Error("Error in getting upload Id: " + err.message);
  }
};

export const getUploadS3PresignedUrls = async (key, uploadId, parts) => {
  try {
    return Promise.all(
      parts.map(async ({ partNumber, contentLength }) => {
        const command = new UploadPartCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          ContentLength: contentLength,
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return { partNumber, contentLength, url };
      }),
    );
  } catch (err) {
    throw new Error("Error in getting presigned urls: " + err.message);
  }
};

export const completeMultipartUpload = async (key, uploadId, parts) => {
  try {
    const command = new CompleteMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    });
    return await s3Client.send(command);
  } catch (err) {
    throw new Error("Error in completing multipart upload: " + err.message);
  }
};

export const deleteS3Objects = async (keys = [], isPublicObjects = false) => {
  try {
    if (!keys || keys.length === 0) {
      return { Deleted: [], Errors: [] };
    }

    let normalizedKeys = keys;
    if (typeof keys[0] === "string") {
      normalizedKeys = keys.map((key) => ({ key }));
    }

    const validKeys = normalizedKeys.filter((item) => item && item.key);
    if (validKeys.length === 0) {
      return { Deleted: [], Errors: [] };
    }

    const MAX_DELETE_BATCH = 1000;
    const batches = [];
    for (let i = 0; i < validKeys.length; i += MAX_DELETE_BATCH) {
      batches.push(validKeys.slice(i, i + MAX_DELETE_BATCH));
    }

    const allResults = { Deleted: [], Errors: [] };

    for (const batch of batches) {
      try {
        if (!isPublicObjects) {
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: {
              Objects: batch.map(({ key }) => ({ Key: key })),
            },
          });

          const response = await s3Client.send(deleteCommand);
          if (response.Deleted) allResults.Deleted.push(...response.Deleted);
          if (response.Errors) allResults.Errors.push(...response.Errors);
        } else {
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: PUBLIC_BUCKET_NAME,
            Delete: {
              Objects: batch.map(({ key }) => ({ Key: key })),
            },
          });

          const response = await s3PublicClient.send(deleteCommand);
          if (response.Deleted) allResults.Deleted.push(...response.Deleted);
          if (response.Errors) allResults.Errors.push(...response.Errors);
        }
      } catch (batchErr) {
        console.error(`Error deleting batch:`, batchErr.message);
        batch.forEach(({ key }) => {
          allResults.Errors.push({
            Key: key,
            Code: "InternalError",
            Message: batchErr.message,
          });
        });
      }
    }

    console.log("Deleted objects results: ", { d: allResults.Deleted });
    return allResults;
  } catch (err) {
    throw new Error("Error in deleting objects: " + err.message);
  }
};

export const abortS3Upload = async (key, uploadId) => {
  try {
    const command = new AbortMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
    });
    return await s3Client.send(command);
  } catch (err) {
    throw new Error("Error in aborting multipart upload: " + err.message);
  }
};

export const getObjectSize = async (key) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    const response = await s3Client.send(command);
    return response.ContentLength ?? null;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      return null;
    }
    throw new Error("Error in reading object metadata: " + err.message);
  }
};

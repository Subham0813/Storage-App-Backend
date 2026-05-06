import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";

const S3_BUCKET = process.env.S3_BUCKET_NAME;
export const s3Client = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

export const getS3UploadId = async (key, mime) => {
  try {
    const command = new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
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
          Bucket: S3_BUCKET,
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
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ ETag: p.ETag, PartNumber: p.partNumber })),
      },
    });
    return await s3Client.send(command);
  } catch (err) {
    throw new Error("Error in completing multipart upload: " + err.message);
  }
};

export const deleteS3Objects = async (keys = []) => {
  try {
    const deleteCommand = new DeleteObjectsCommand({
      Bucket: S3_BUCKET,
      Delete: {
        Objects: keys.map(({ key }) => ({ Key: key })),
      },
    });
    return await s3Client.send(deleteCommand);
  } catch (err) {
    throw new Error("Error in deleting object: " + err.message);
  }
};

export const abortS3Upload = async (key, uploadId) => {
  try {
    const command = new AbortMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
    });
    return await s3Client.send(command);
  } catch (err) {
    throw new Error("Error in aborting multipart upload: " + err.message);
  }
};

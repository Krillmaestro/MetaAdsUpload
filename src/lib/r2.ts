import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

export function getR2Bucket() {
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!bucket) throw new Error("R2_BUCKET_NAME not configured");
  return bucket;
}

export function getR2PublicUrl() {
  return process.env.R2_PUBLIC_URL?.trim() || "";
}

// Remove objects for good. Errors are swallowed on purpose: a file that is
// already gone must not block the row update that says it is gone.
export async function deleteR2Objects(keys: Array<string | null | undefined>): Promise<void> {
  const list = keys.filter((k): k is string => !!k);
  if (list.length === 0) return;
  try {
    await getR2Client().send(new DeleteObjectsCommand({
      Bucket: getR2Bucket(),
      Delete: { Objects: list.map((Key) => ({ Key })), Quiet: true },
    }));
  } catch (e) {
    console.error("R2 delete failed:", list, e);
  }
}

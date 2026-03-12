import { google } from "googleapis";

function getAuth() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not configured");

  const credentials = JSON.parse(key);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

export function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: "v3", auth });
}

export async function listFiles(folderId?: string) {
  const drive = getDriveClient();
  const parentId = folderId || process.env.GOOGLE_DRIVE_ROOT_FOLDER;
  if (!parentId) throw new Error("No folder ID provided");

  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,size,thumbnailLink,videoMediaMetadata,imageMediaMetadata,createdTime)",
    orderBy: "createdTime desc",
    pageSize: 100,
  });

  return res.data.files || [];
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

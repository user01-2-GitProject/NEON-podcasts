import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { sql } from "@/lib/db";

export interface StorageProvider {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  url(key: string): string;
}

class DatabaseStorage implements StorageProvider {
  async put(key: string, bytes: Buffer, contentType: string) {
    const audioB64 = bytes.toString("base64");
    await sql`
      insert into episode_audio (episode_id, content_type, data)
      values (${key}, ${contentType}, decode(${audioB64}, 'base64'))
      on conflict (episode_id) do update
        set content_type = excluded.content_type, data = excluded.data
    `;
  }

  async get(key: string) {
    const rows = (await sql`
      select content_type, data from episode_audio where episode_id = ${key}
    `) as { content_type: string; data: Buffer }[];
    return rows[0] ? { bytes: Buffer.from(rows[0].data), contentType: rows[0].content_type } : null;
  }

  url(key: string) {
    return `/api/episodes/${key}/audio`;
  }
}

class S3Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket = process.env.S3_BUCKET!;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!endpoint || !this.bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required when STORAGE_PROVIDER=s3");
    }
    this.client = new S3Client({
      endpoint,
      region: process.env.S3_REGION || (endpoint.includes("r2.cloudflarestorage.com") ? "auto" : "us-east-1"),
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) return null;
    return {
      bytes: Buffer.from(await result.Body.transformToByteArray()),
      contentType: result.ContentType || "audio/mpeg",
    };
  }

  url(key: string) {
    const base = process.env.S3_PUBLIC_BASE_URL;
    return base ? `${base.replace(/\/$/, "")}/${key}` : `/api/episodes/${key}/audio`;
  }
}

let provider: StorageProvider | undefined;
export function getStorage(): StorageProvider {
  if (!provider) provider = process.env.STORAGE_PROVIDER === "s3" ? new S3Storage() : new DatabaseStorage();
  return provider;
}

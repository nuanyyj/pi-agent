/**
 * Enterprise artifact storage using MinIO (S3-compatible).
 *
 * Artifacts are stored as: {organizationId}/{runId}/{filename}
 * Provides upload, download, and list operations.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

// ── Config ─────────────────────────────────────────────────────────────

const MINIO_ENDPOINT = process.env.PI_MINIO_ENDPOINT ?? "http://127.0.0.1:19000";
const MINIO_ACCESS_KEY = process.env.PI_MINIO_ROOT_USER ?? "";
const MINIO_SECRET_KEY = process.env.PI_MINIO_ROOT_PASSWORD ?? "";
const MINIO_BUCKET = process.env.PI_MINIO_BUCKET ?? "pi-artifacts";

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY) return null;
  if (!_client) {
    _client = new S3Client({
      endpoint: MINIO_ENDPOINT,
      region: "us-east-1", // MinIO doesn't care about region
      forcePathStyle: true, // Required for MinIO
      credentials: {
        accessKeyId: MINIO_ACCESS_KEY,
        secretAccessKey: MINIO_SECRET_KEY,
      },
    });
  }
  return _client;
}

/** Check if MinIO is configured and reachable. */
export function isArtifactStorageEnabled(): boolean {
  return Boolean(MINIO_ACCESS_KEY && MINIO_SECRET_KEY);
}

// ── Types ──────────────────────────────────────────────────────────────

export interface ArtifactInfo {
  key: string;
  filename: string;
  size: number;
  lastModified: string;
}

export interface UploadArtifactInput {
  organizationId: string;
  runId: string;
  filename: string;
  data: Buffer | Uint8Array | string;
  contentType?: string;
}

// ── Operations ─────────────────────────────────────────────────────────

/**
 * Upload an artifact to MinIO.
 */
export async function uploadArtifact(input: UploadArtifactInput): Promise<ArtifactInfo> {
  const client = getClient();
  if (!client) throw new Error("Artifact storage not configured");

  const key = `${input.organizationId}/${input.runId}/${input.filename}`;
  const body = typeof input.data === "string" ? Buffer.from(input.data) : input.data;

  await client.send(
    new PutObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
      Body: body,
      ContentType: input.contentType ?? "application/octet-stream",
    }),
  );

  return {
    key,
    filename: input.filename,
    size: body.length,
    lastModified: new Date().toISOString(),
  };
}

/**
 * Download an artifact from MinIO. Returns the raw bytes.
 */
export async function downloadArtifact(key: string): Promise<{ data: Buffer; contentType: string }> {
  const client = getClient();
  if (!client) throw new Error("Artifact storage not configured");

  const resp = await client.send(
    new GetObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
    }),
  );

  const chunks: Uint8Array[] = [];
  const stream = resp.Body as NodeJS.ReadableStream;
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return {
    data: Buffer.concat(chunks),
    contentType: resp.ContentType ?? "application/octet-stream",
  };
}

/**
 * List artifacts for a run.
 */
export async function listArtifacts(organizationId: string, runId: string): Promise<ArtifactInfo[]> {
  const client = getClient();
  if (!client) throw new Error("Artifact storage not configured");

  const prefix = `${organizationId}/${runId}/`;
  const resp = await client.send(
    new ListObjectsV2Command({
      Bucket: MINIO_BUCKET,
      Prefix: prefix,
    }),
  );

  return (resp.Contents ?? []).map((obj) => ({
    key: obj.Key!,
    filename: obj.Key!.slice(prefix.length),
    size: obj.Size ?? 0,
    lastModified: (obj.LastModified ?? new Date()).toISOString(),
  }));
}

/**
 * Delete a single artifact.
 */
export async function deleteArtifact(key: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error("Artifact storage not configured");

  await client.send(
    new DeleteObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
    }),
  );
}

/**
 * Check if an artifact exists.
 */
export async function artifactExists(key: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

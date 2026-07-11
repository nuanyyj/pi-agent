"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface ArtifactInfo {
  key: string;
  filename: string;
  size: number;
  lastModified: string;
}

interface Props {
  runId: string;
  /** Show upload button */
  allowUpload?: boolean;
}

/**
 * Displays artifacts for a run. Supports download and optional upload.
 */
export function ArtifactList({ runId, allowUpload }: Props) {
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/enterprise/v1/runs/${encodeURIComponent(runId)}/artifacts`);
      if (!res.ok) {
        if (res.status === 503) {
          setArtifacts([]);
          return;
        }
        throw new Error("Failed to load artifacts");
      }
      const data = (await res.json()) as { artifacts: ArtifactInfo[] };
      setArtifacts(data.artifacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  const handleDownload = useCallback((key: string, filename: string) => {
    const url = `/api/enterprise/v1/artifacts?key=${encodeURIComponent(key)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch(`/api/enterprise/v1/runs/${encodeURIComponent(runId)}/artifacts`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error("Upload failed");
      await loadArtifacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [runId, loadArtifacts]);

  if (loading && artifacts.length === 0) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-dim)" }}>
        Loading artifacts...
      </div>
    );
  }

  if (!loading && artifacts.length === 0 && !allowUpload) {
    return null;
  }

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      background: "var(--bg-panel)",
      padding: "8px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
          Artifacts ({artifacts.length})
        </span>
        {allowUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                height: 22, padding: "0 8px", fontSize: 10,
                background: "var(--accent)", color: "#fff",
                border: "none", borderRadius: 4,
                cursor: uploading ? "default" : "pointer",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 4 }}>{error}</div>
      )}

      {artifacts.map((a) => (
        <div
          key={a.key}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 0", fontSize: 12,
          }}
        >
          <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
            {a.filename}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {formatSize(a.size)}
            </span>
            <button
              onClick={() => handleDownload(a.key, a.filename)}
              style={{
                height: 20, padding: "0 6px", fontSize: 10,
                background: "transparent", color: "var(--accent)",
                border: "1px solid var(--border)", borderRadius: 3,
                cursor: "pointer",
              }}
            >
              ↓
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

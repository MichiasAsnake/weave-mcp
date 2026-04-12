const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const STORE_ROOT = path.resolve(process.cwd(), ".data", "uploads");

async function saveUploadedAsset(file, options = {}) {
  if (!file) {
    throw new Error("A file is required.");
  }

  await fs.mkdir(STORE_ROOT, { recursive: true });

  const id = randomUUID();
  const sourceName = String(file.name || "asset");
  const extension = normalizeExtension(sourceName, file.type);
  const filename = `${id}${extension}`;
  const absolutePath = path.join(STORE_ROOT, filename);
  const metadataPath = path.join(STORE_ROOT, `${id}.json`);
  const buffer = Buffer.from(await file.arrayBuffer());

  await fs.writeFile(absolutePath, buffer);

  const metadata = {
    id,
    filename,
    originalName: sourceName,
    contentType: file.type || inferContentType(extension),
    size: buffer.length,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  const origin = String(options.origin || "").replace(/\/$/, "");
  const urlPath = `/api/assets/${id}`;
  const publicUrl = origin ? `${origin}${urlPath}` : urlPath;

  return {
    ...metadata,
    urlPath,
    publicUrl,
    localOnly: isLocalOrigin(origin),
  };
}

async function readStoredAsset(id) {
  const metadataPath = path.join(STORE_ROOT, `${id}.json`);
  const metadataText = await fs.readFile(metadataPath, "utf8");
  const metadata = JSON.parse(metadataText);
  const filePath = path.join(STORE_ROOT, metadata.filename);
  const buffer = await fs.readFile(filePath);

  return {
    metadata,
    buffer,
  };
}

function normalizeExtension(filename, contentType) {
  const extension = path.extname(filename || "").trim();
  if (extension) {
    return extension.toLowerCase();
  }

  const fallback = extensionFromContentType(contentType);
  return fallback || ".bin";
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }
  if (normalized === "video/mp4") {
    return ".mp4";
  }
  if (normalized === "video/quicktime") {
    return ".mov";
  }
  return "";
}

function inferContentType(extension) {
  switch (String(extension || "").toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

function isLocalOrigin(origin) {
  return /:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(String(origin || ""));
}

module.exports = {
  saveUploadedAsset,
  readStoredAsset,
};

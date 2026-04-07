const crypto = require("crypto");
const path = require("path");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require("@azure/storage-blob");

const getEnv = (key) => {
  const v = process.env[key];
  return typeof v === "string" ? v.trim() : "";
};

const connectionString = getEnv("AZURE_STORAGE_CONNECTION_STRING");
const questionImagesContainer = getEnv("AZURE_BLOB_CONTAINER_QUESTION_IMAGES") || "question-images";

const getBlobServiceClient = () => {
  if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not configured");
  }
  return BlobServiceClient.fromConnectionString(connectionString);
};

const parseConnectionString = (cs) => {
  const out = {};
  String(cs)
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i === -1) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      out[k] = v;
    });
  return out;
};

/** Readable URL for <img src>: SAS for private containers, otherwise stored url. */
async function getViewUrlForQuestionImage(img) {
  if (!img) return "";
  const stored = typeof img.url === "string" ? img.url.trim() : "";

  if (img.blobName && connectionString) {
    try {
      const parsed = parseConnectionString(connectionString);
      const accountName = parsed.AccountName;
      const accountKey = parsed.AccountKey;
      if (!accountName || !accountKey) {
        return stored;
      }

      const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
      const blobService = getBlobServiceClient();
      const containerClient = blobService.getContainerClient(questionImagesContainer);
      const blobClient = containerClient.getBlobClient(img.blobName);

      const rawMinutes = parseInt(process.env.AZURE_BLOB_SAS_MINUTES || "120", 10);
      const sasMinutes = Math.min(Math.max(Number.isFinite(rawMinutes) ? rawMinutes : 120, 5), 7 * 24 * 60);

      const sas = generateBlobSASQueryParameters(
        {
          containerName: questionImagesContainer,
          blobName: img.blobName,
          permissions: BlobSASPermissions.parse("r"),
          startsOn: new Date(Date.now() - 5 * 60 * 1000),
          expiresOn: new Date(Date.now() + sasMinutes * 60 * 1000),
          protocol: SASProtocol.Https,
        },
        sharedKeyCredential
      ).toString();

      return `${blobClient.url}?${sas}`;
    } catch {
      return stored;
    }
  }

  return stored;
}

async function hydrateQuestionImages(questionPlain) {
  if (!questionPlain?.images?.length) return questionPlain;
  const images = await Promise.all(
    questionPlain.images.map(async (img) => {
      const viewUrl = await getViewUrlForQuestionImage(img);
      // For private containers, overwrite url with SAS so ALL existing UIs work.
      return {
        ...img,
        viewUrl,
        url: viewUrl || img.url,
      };
    })
  );
  return { ...questionPlain, images };
}

const guessExtension = (originalName = "", contentType = "") => {
  const ext = path.extname(originalName || "").toLowerCase();
  if (ext && ext.length <= 6) return ext;

  const ct = String(contentType).toLowerCase();
  if (ct === "image/jpeg") return ".jpg";
  if (ct === "image/png") return ".png";
  if (ct === "image/gif") return ".gif";
  if (ct === "image/webp") return ".webp";
  return "";
};

const buildBlobName = ({ questionId, originalName, contentType }) => {
  const ext = guessExtension(originalName, contentType);
  const rand = crypto.randomBytes(10).toString("hex");
  const ts = Date.now();
  return `questions/${questionId}/${ts}-${rand}${ext}`;
};

const ensureContainer = async (containerClient) => {
  await containerClient.createIfNotExists();
};

async function uploadQuestionImage({ questionId, buffer, contentType, originalName }) {
  if (!questionId) throw new Error("questionId is required");
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("buffer is required");

  const blobService = getBlobServiceClient();
  const containerClient = blobService.getContainerClient(questionImagesContainer);
  await ensureContainer(containerClient);

  const blobName = buildBlobName({ questionId, originalName, contentType });
  const blockBlob = containerClient.getBlockBlobClient(blobName);

  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType || "application/octet-stream",
    },
  });

  return {
    blobName,
    url: blockBlob.url,
  };
}

async function deleteBlobIfExists(blobName) {
  if (!blobName) return;
  const blobService = getBlobServiceClient();
  const containerClient = blobService.getContainerClient(questionImagesContainer);
  const blobClient = containerClient.getBlobClient(blobName);
  await blobClient.deleteIfExists();
}

module.exports = {
  uploadQuestionImage,
  deleteBlobIfExists,
  getViewUrlForQuestionImage,
  hydrateQuestionImages,
};


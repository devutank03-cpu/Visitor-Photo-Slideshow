import { v2 as cloudinary, UploadApiResponse } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

/**
 * Uploads an in-memory image buffer directly to Cloudinary
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  folder = "visitor-slideshow"
): Promise<{ secure_url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) {
          reject(error || new Error("Cloudinary upload failed with empty result"));
        } else {
          resolve({
            secure_url: result.secure_url,
            public_id: result.public_id,
          });
        }
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Extracts the Cloudinary public_id from a Cloudinary secure_url or publicId string
 */
export function extractCloudinaryPublicId(imageUrlOrPublicId: string): string | null {
  if (!imageUrlOrPublicId) return null;

  // If already a public_id (e.g. "visitor-slideshow/abc123xyz")
  if (!imageUrlOrPublicId.startsWith("http://") && !imageUrlOrPublicId.startsWith("https://")) {
    return imageUrlOrPublicId;
  }

  // Parse from Cloudinary URL:
  // e.g. https://res.cloudinary.com/<cloud_name>/image/upload/v1234567/visitor-slideshow/sample.jpg
  try {
    const parts = imageUrlOrPublicId.split("/upload/");
    if (parts.length < 2) return null;

    let pathAfterUpload = parts[1];
    // Strip version prefix if present (v1234567/)
    pathAfterUpload = pathAfterUpload.replace(/^v\d+\//, "");

    // Strip extension (.jpg, .png, etc.)
    const lastDotIndex = pathAfterUpload.lastIndexOf(".");
    if (lastDotIndex !== -1) {
      pathAfterUpload = pathAfterUpload.substring(0, lastDotIndex);
    }

    return pathAfterUpload;
  } catch {
    return null;
  }
}

/**
 * Deletes an image asset from Cloudinary
 */
export async function deleteCloudinaryAsset(imageUrlOrPublicId: string): Promise<boolean> {
  const publicId = extractCloudinaryPublicId(imageUrlOrPublicId);
  if (!publicId) return false;

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === "ok";
  } catch (err) {
    console.error(`Failed to delete Cloudinary asset (${publicId}):`, err);
    return false;
  }
}

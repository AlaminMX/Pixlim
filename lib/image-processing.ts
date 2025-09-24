import imageCompression from "browser-image-compression"
import JSZip from "jszip"

/**
 * Compresses an image file using browser-image-compression.
 * Automatically handles resizing for very large images and converts to target format.
 * @param file The image file to compress.
 * @param quality The compression quality (0 to 100).
 * @returns A promise that resolves to an object containing the compressed Blob and its Data URL.
 */
export async function compressImage(file: File, quality: number): Promise<{ blob: Blob; dataUrl: string }> {
  const options = {
    maxSizeMB: 10, // (default: Number.POSITIVE_INFINITY)
    maxWidthOrHeight: 1920, // Max width/height for very large images (e.g., 4K images)
    useWebWorker: true, // Use web worker for better performance
    maxIteration: 10, // (default: 10)
    initialQuality: quality / 100, // Convert 1-100 to 0-1
    fileType: file.type, // Keep original file type or convert if specified
  }

  try {
    const compressedBlob = await imageCompression(file, options)
    const dataUrl = await imageCompression.getDataUrlFromFile(compressedBlob)
    return { blob: compressedBlob, dataUrl }
  } catch (error) {
    console.error("Error during image compression:", error)
    throw new Error(`Failed to compress image: ${file.name}. ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Reads a File object as a Data URL.
 * @param file The File object to read.
 * @returns A promise that resolves to the Data URL string.
 */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = (error) => reject(error)
    reader.readAsDataURL(file)
  })
}

/**
 * Creates a ZIP file from an array of files.
 * @param files An array of objects, each with a `name` (filename) and `blob` (file content as Blob).
 * @returns A promise that resolves to the ZIP file as a Blob.
 */
export async function createZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.name, file.blob)
  }
  return zip.generateAsync({ type: "blob" })
}

/**
 * Gets the common file extension for a given MIME type.
 * @param mimeType The MIME type of the file (e.g., "image/jpeg").
 * @returns The file extension (e.g., "jpg", "png", "webp").
 */
export function getFileExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    default:
      return "bin" // Fallback for unknown types
  }
}

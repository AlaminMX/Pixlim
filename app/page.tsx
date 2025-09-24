"use client"

import type React from "react"

import { useState, useCallback, useEffect } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Download, FolderArchive, Sun, Moon, XCircle } from "lucide-react"
import { compressImage, createZip, readFileAsDataURL, getFileExtension } from "@/lib/image-processing"
import { cn } from "@/lib/utils"

interface CompressedImage {
  id: string
  file: File // Original file
  originalUrl: string // Data URL of original thumbnail
  originalSize: number // Bytes
  compressedUrl: string | null // Data URL of compressed thumbnail
  compressedBlob: Blob | null // Blob of compressed image for download
  compressedSize: number | null // Bytes
  status: "pending" | "compressing" | "completed" | "error"
  error?: string
  quality: number // Quality used for this image
}

export default function HomePage() {
  const [images, setImages] = useState<CompressedImage[]>([])
  const [compressionQuality, setCompressionQuality] = useState<number>(80)
  const [isProcessing, setIsProcessing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()

  // Prevent hydration mismatch for theme
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    // Register service worker for PWA capabilities
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => {
          console.log("Service Worker registered successfully with scope:", registration.scope)
        })
        .catch((error) => {
          // Silently handle service worker registration failures in preview environments
          console.warn("Service Worker registration failed (this is expected in preview environments):", error.message)
          // The app will still work perfectly without the service worker
        })
    }
  }, [])

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsProcessing(true)
      const droppedItems = Array.from(event.dataTransfer.items)
      const files: File[] = []

      const processEntry = async (entry: FileSystemEntry) => {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve) => (entry as FileSystemFileEntry).file(resolve))
          if (
            file.type.startsWith("image/jpeg") ||
            file.type.startsWith("image/png") ||
            file.type.startsWith("image/webp")
          ) {
            files.push(file)
          }
        } else if (entry.isDirectory) {
          const reader = (entry as FileSystemDirectoryEntry).createReader()
          const entries = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve))
          for (const subEntry of entries) {
            await processEntry(subEntry)
          }
        }
      }

      for (const item of droppedItems) {
        if (item.kind === "file") {
          const entry = item.webkitGetAsEntry()
          if (entry) {
            await processEntry(entry)
          } else {
            // Fallback for non-webkit browsers or direct file drops
            const file = item.getAsFile()
            if (
              file &&
              (file.type.startsWith("image/jpeg") ||
                file.type.startsWith("image/png") ||
                file.type.startsWith("image/webp"))
            ) {
              files.push(file)
            }
          }
        }
      }

      await processFiles(files)
      setIsProcessing(false)
    },
    [compressionQuality, images], // Include images in dependency array to ensure latest state
  )

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      setIsProcessing(true)
      const files = Array.from(event.target.files || []).filter(
        (file) =>
          file.type.startsWith("image/jpeg") || file.type.startsWith("image/png") || file.type.startsWith("image/webp"),
      )
      await processFiles(files)
      setIsProcessing(false)
    },
    [compressionQuality, images],
  )

  const processFiles = async (newFiles: File[]) => {
    const newImages: CompressedImage[] = []
    for (const file of newFiles) {
      const originalUrl = await readFileAsDataURL(file)
      newImages.push({
        id: `${file.name}-${Date.now()}`,
        file,
        originalUrl,
        originalSize: file.size,
        compressedUrl: null,
        compressedBlob: null,
        compressedSize: null,
        status: "pending",
        quality: compressionQuality,
      })
    }
    setImages((prev) => [...prev, ...newImages])
    await compressAllImages(compressionQuality, [...images, ...newImages]) // Re-compress all images with new quality
  }

  const compressAllImages = useCallback(async (quality: number, currentImages: CompressedImage[]) => {
    const updatedImages = await Promise.all(
      currentImages.map(async (img) => {
        if (img.status === "error" && img.quality === quality) {
          // Don't re-process images that failed unless quality changes
          return img
        }
        try {
          setImages((prev) =>
            prev.map((i) => (i.id === img.id ? { ...i, status: "compressing", quality: quality } : i)),
          )
          const compressedResult = await compressImage(img.file, quality)
          return {
            ...img,
            compressedUrl: compressedResult.dataUrl,
            compressedBlob: compressedResult.blob,
            compressedSize: compressedResult.blob.size,
            status: "completed",
            quality: quality,
            error: undefined,
          }
        } catch (error: any) {
          console.error("Compression error:", error)
          return {
            ...img,
            compressedUrl: null,
            compressedBlob: null,
            compressedSize: null,
            status: "error",
            error: error.message || "Compression failed",
            quality: quality,
          }
        }
      }),
    )
    setImages(updatedImages)
  }, [])

  useEffect(() => {
    if (images.length > 0) {
      compressAllImages(compressionQuality, images)
    }
  }, [compressionQuality]) // Re-compress all images when quality changes

  const handleRemoveImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const handleDownloadAll = async () => {
    const completedImages = images.filter((img) => img.status === "completed" && img.compressedBlob)
    if (completedImages.length === 0) return

    if (completedImages.length === 1) {
      // If only one image, download it directly
      const img = completedImages[0]
      const url = URL.createObjectURL(img.compressedBlob!)
      const a = document.createElement("a")
      a.href = url
      a.download = `compressed_${img.file.name.replace(/\.[^/.]+$/, "")}.${getFileExtension(img.file.type)}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      // If multiple images, create a ZIP
      const filesToZip = completedImages.map((img) => ({
        name: `compressed_${img.file.name.replace(/\.[^/.]+$/, "")}.${getFileExtension(img.file.type)}`,
        blob: img.compressedBlob!,
      }))

      try {
        const zipBlob = await createZip(filesToZip)
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement("a")
        a.href = url
        a.download = "LitePress_Compressed_Images.zip"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error("Error creating ZIP:", error)
        alert("Failed to create ZIP file.")
      }
    }
  }

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  if (!mounted) {
    return null
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Pixlim</h1>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle dark mode">
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="container flex flex-1 flex-col items-center py-8">
        <section className="w-full max-w-4xl space-y-6">
          <Card className="p-6">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-center text-3xl">Compress Your Images</CardTitle>
              <CardDescription className="text-center">
                Drag & drop your JPG, PNG, or WebP files and folders here.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className={cn(
                  "relative flex min-h-[200px] w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 p-6 text-center transition-colors hover:border-primary",
                  isProcessing && "pointer-events-none opacity-70",
                )}
              >
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileSelect}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <div className="space-y-2">
                  <FolderArchive className="mx-auto h-12 w-12 text-primary" />
                  <p className="text-lg font-medium">Drag & Drop Files or Folders</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                </div>
                {isProcessing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                    <p className="text-lg font-semibold text-primary">Processing...</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {images.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Compression Settings</CardTitle>
                <CardDescription>Adjust the quality for all images.</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <Label htmlFor="quality-slider" className="w-24 shrink-0">
                  Quality: {compressionQuality}%
                </Label>
                <Slider
                  id="quality-slider"
                  min={1}
                  max={100}
                  step={1}
                  value={[compressionQuality]}
                  onValueChange={(value) => setCompressionQuality(value[0])}
                  className="flex-1"
                />
              </CardContent>
              <CardFooter className="flex justify-end">
                <Button onClick={handleDownloadAll} disabled={images.every((img) => img.status !== "completed")}>
                  <Download className="mr-2 h-4 w-4" /> Download All (
                  {images.filter((img) => img.status === "completed").length})
                </Button>
              </CardFooter>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((img) => (
              <ImageCard key={img.id} image={img} onRemove={handleRemoveImage} />
            ))}
          </div>
        </section>

        <Separator className="my-12 w-full max-w-4xl" />

        <section className="w-full max-w-4xl space-y-4 text-center">
          <h2 className="text-2xl font-bold">How LitePress Works</h2>
          <p className="text-muted-foreground">LitePress is a 100% client-side image compressor. This means:</p>
          <ul className="list-inside list-disc space-y-2 text-left text-muted-foreground">
            <li>
              <span className="font-semibold text-foreground">Privacy:</span> Your images never leave your browser. All
              compression happens directly on your device.
            </li>

            <li>
              <span className="font-semibold text-foreground">Speed:</span> Leveraging modern browser APIs, images are
              processed quickly without relying on external servers.
            </li>
            <li>
              <span className="font-semibold text-foreground">Technology:</span> It uses JavaScript's Canvas API and
              libraries like `browser-image-compression` to efficiently resize and re-encode images.
            </li>
          </ul>
        </section>
      </main>

      <footer className="py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} LitePress. All rights reserved.
        <br />
        Powered by Nexel.
      </footer>
    </div>
  )
}

function ImageCard({ image, onRemove }: { image: CompressedImage; onRemove: (id: string) => void }) {
  const handleDownload = () => {
    if (image.compressedBlob) {
      const url = URL.createObjectURL(image.compressedBlob)
      const a = document.createElement("a")
      a.href = url
      a.download = `compressed_${image.file.name.replace(/\.[^/.]+$/, "")}.${getFileExtension(image.file.type)}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "N/A"
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const reductionPercentage =
    image.originalSize && image.compressedSize
      ? (((image.originalSize - image.compressedSize) / image.originalSize) * 100).toFixed(1)
      : "0"

  return (
    <Card className="relative overflow-hidden">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground"
        onClick={() => onRemove(image.id)}
        aria-label="Remove image"
      >
        <XCircle className="h-5 w-5" />
      </Button>
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-center gap-2">
          <div className="relative h-24 w-24 overflow-hidden rounded-md border">
            {image.originalUrl ? (
              <img
                src={image.originalUrl || "/placeholder.svg"}
                alt="Original thumbnail"
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                No preview
              </div>
            )}
            <span className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center text-xs text-white">
              Original
            </span>
          </div>
          <div className="relative h-24 w-24 overflow-hidden rounded-md border">
            {image.status === "completed" && image.compressedUrl ? (
              <img
                src={image.compressedUrl || "/placeholder.svg"}
                alt="Compressed thumbnail"
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : image.status === "compressing" ? (
              <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                Compressing...
              </div>
            ) : image.status === "error" ? (
              <div className="flex h-full w-full items-center justify-center bg-destructive/10 text-center text-xs text-destructive">
                Error: {image.error}
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                Pending
              </div>
            )}
            <span className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center text-xs text-white">
              Compressed
            </span>
          </div>
        </div>

        <p className="truncate text-sm font-medium">{image.file.name}</p>
        <p className="text-xs text-muted-foreground">Quality: {image.quality}%</p>
        <div className="mt-2 text-sm">
          <p>
            Original Size: <span className="font-semibold">{formatBytes(image.originalSize)}</span>
          </p>
          <p>
            Compressed Size:{" "}
            <span className="font-semibold">
              {formatBytes(image.compressedSize)}{" "}
              {image.compressedSize !== null && image.originalSize !== null && image.originalSize > 0 && (
                <span className="text-xs text-green-600 dark:text-green-400">({reductionPercentage}% reduction)</span>
              )}
            </span>
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end p-4 pt-0">
        <Button onClick={handleDownload} disabled={image.status !== "completed"}>
          <Download className="mr-2 h-4 w-4" /> Download
        </Button>
      </CardFooter>
    </Card>
  )
}

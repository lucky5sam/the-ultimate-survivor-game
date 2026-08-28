// Shared image-upload helper for the single public `uploads` Storage bucket.
// Used for team images (prefix `teams`) and user avatars (prefix `avatars`).
//
// Every upload is downscaled + re-encoded to webp client-side (keeps files
// small, normalizes format) and written to a unique UUID path — a fresh path
// per upload means the public CDN URL never serves a stale cached image.
import { supabase } from './supabase'

const BUCKET = 'uploads'
const MAX_DIMENSION = 512 // longest edge, in px, after downscale
const WEBP_QUALITY = 0.85
const MAX_INPUT_BYTES = 8 * 1024 * 1024 // reject huge files before decoding

export type UploadPrefix = 'teams' | 'avatars'

// Decode the file, downscale so the longest edge is <= MAX_DIMENSION (never
// upscaling), and re-encode as webp. Returns the encoded Blob.
async function downscaleToWebp(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the image file.'))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('That file could not be loaded as an image.'))
    el.src = dataUrl
  })

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the image.')
  ctx.drawImage(img, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
  )
  if (!blob) throw new Error('Could not encode the image.')
  return blob
}

// Validate, downscale, upload, and return the public URL. Throws on any
// failure so callers can surface it (toast / inline error).
export async function uploadImage(file: File, prefix: UploadPrefix): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is too large (max 8MB).')
  }

  const blob = await downscaleToWebp(file)
  const path = `${prefix}/${crypto.randomUUID()}.webp`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/webp', upsert: false })
  if (error) throw error

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

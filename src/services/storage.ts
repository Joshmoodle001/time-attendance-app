import { isSupabaseConfigured, supabase, supabaseConfigurationError } from '@/lib/supabase'

const BUCKET_NAME = 'attendance-files'

export interface UploadResult {
  success: boolean
  url?: string
  error?: string
}

export async function uploadAttendanceFile(file: File): Promise<UploadResult> {
   try {
     if (!isSupabaseConfigured) {
       return { success: false, error: supabaseConfigurationError }
     }

     const fileExt = file.name.split('.').pop()
     const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
     const filePath = `uploads/${fileName}`

     const { error } = await supabase.storage
       .from(BUCKET_NAME)
       .upload(filePath, file, {
         cacheControl: '3600',
         upsert: false,
       })

     if (error) {
       console.error('Supabase upload error:', error)
       return { success: false, error: error.message }
     }

     // The bucket should remain private. Do not generate public URLs here.
     return { success: true, url: 'private storage' }
   } catch (err) {
     console.error('Upload error:', err)
     return {
       success: false,
       error: err instanceof Error ? err.message : 'Unknown upload error',
     }
   }
 }

export async function downloadFile(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.blob()
  } catch (err) {
    console.error('Download error:', err)
    return null
  }
}

export async function listFiles(prefix?: string) {
  try {
    if (!isSupabaseConfigured) return []

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(prefix || 'uploads', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      })

    if (error) throw error
    return data
  } catch (err) {
    console.error('List files error:', err)
    return []
  }
}

export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    if (!isSupabaseConfigured) return false

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath])

    if (error) throw error
    return true
  } catch (err) {
    console.error('Delete error:', err)
    return false
  }
}

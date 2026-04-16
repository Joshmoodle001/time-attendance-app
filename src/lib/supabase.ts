import { createClient } from '@supabase/supabase-js'

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const configuredSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

export const isSupabaseConfigured = Boolean(configuredSupabaseUrl && configuredSupabaseAnonKey)

export const supabaseConfigurationError = isSupabaseConfigured
  ? ''
  : 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud sync and storage.'

const fallbackSupabaseUrl = 'https://placeholder.supabase.co'
const fallbackSupabaseAnonKey = 'placeholder-anon-key'

export const supabase = createClient(
  isSupabaseConfigured ? configuredSupabaseUrl : fallbackSupabaseUrl,
  isSupabaseConfigured ? configuredSupabaseAnonKey : fallbackSupabaseAnonKey
)

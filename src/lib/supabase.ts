import { createClient } from '@supabase/supabase-js'

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const configuredSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

function decodeSupabaseProjectRefFromJwt(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return ''

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')))
    return String(decoded?.ref || '').trim()
  } catch {
    return ''
  }
}

function buildSupabaseUrlFromAnonKey(anonKey: string) {
  const ref = decodeSupabaseProjectRefFromJwt(anonKey)
  return ref ? `https://${ref}.supabase.co` : ''
}

const derivedSupabaseUrl = buildSupabaseUrlFromAnonKey(configuredSupabaseAnonKey)

function resolveSupabaseUrl(configuredUrl: string, fallbackUrl: string) {
  if (!configuredUrl) return fallbackUrl

  try {
    const configuredHost = new URL(configuredUrl).hostname.toLowerCase()
    const fallbackHost = fallbackUrl ? new URL(fallbackUrl).hostname.toLowerCase() : ''

    if (fallbackHost && configuredHost !== fallbackHost) {
      return fallbackUrl
    }
  } catch {
    return fallbackUrl || configuredUrl
  }

  return configuredUrl
}

const effectiveSupabaseUrl = resolveSupabaseUrl(configuredSupabaseUrl, derivedSupabaseUrl)

export const isSupabaseConfigured = Boolean(effectiveSupabaseUrl && configuredSupabaseAnonKey)

export const supabaseConfigurationError = isSupabaseConfigured
  ? ''
  : 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud sync and storage.'

const fallbackSupabaseUrl = 'https://placeholder.supabase.co'
const fallbackSupabaseAnonKey = 'placeholder-anon-key'

export const supabase = createClient(
  isSupabaseConfigured ? effectiveSupabaseUrl : fallbackSupabaseUrl,
  isSupabaseConfigured ? configuredSupabaseAnonKey : fallbackSupabaseAnonKey
)

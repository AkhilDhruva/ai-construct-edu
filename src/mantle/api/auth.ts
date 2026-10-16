// Sign-in for API mode. The browser does OAuth 2.1 with PKCE directly with the identity
// provider; the API only ever sees the provider's JWT. Two modes:
//   supabase — Supabase Auth (GitHub / Google OAuth with PKCE, or an email magic link)
//   dev      — local tokens from the API's /dev/token (refused by a production API)

export type AuthMode = 'supabase' | 'dev'

export interface AuthProvider {
  mode: AuthMode
  token(): Promise<string | undefined>
  signOut(): Promise<void>
}

const DEV_KEY = 'mantle:dev-token'

export function devAuth(): AuthProvider & { setToken(t: string): void } {
  const read = () => {
    try {
      return sessionStorage.getItem(DEV_KEY) ?? undefined
    } catch {
      return undefined
    }
  }
  return {
    mode: 'dev',
    async token() {
      return read()
    },
    setToken(t: string) {
      try {
        sessionStorage.setItem(DEV_KEY, t)
      } catch {
        /* tab-only session */
      }
    },
    async signOut() {
      try {
        sessionStorage.removeItem(DEV_KEY)
      } catch {
        /* nothing stored */
      }
    },
  }
}

export interface SupabaseAuth extends AuthProvider {
  signInWithOAuth(provider: 'github' | 'google'): Promise<void>
  signInWithEmail(email: string): Promise<void>
}

/** Loaded on demand so the offline bundle never carries the Supabase client. */
export async function supabaseAuth(url: string, anonKey: string): Promise<SupabaseAuth> {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(url, anonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  const redirectTo = `${window.location.origin}/settings`
  return {
    mode: 'supabase',
    async token() {
      const { data } = await client.auth.getSession()
      return data.session?.access_token
    },
    async signOut() {
      await client.auth.signOut()
    },
    async signInWithOAuth(provider) {
      const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } })
      if (error) throw error
    },
    async signInWithEmail(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
      if (error) throw error
    },
  }
}

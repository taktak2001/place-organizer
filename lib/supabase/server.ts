import { createClient } from "@supabase/supabase-js";

export function getPublicSupabaseEnvStatus() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return {
    hasUrl,
    hasAnonKey,
    missing: [
      hasUrl ? null : "NEXT_PUBLIC_SUPABASE_URL",
      hasAnonKey ? null : "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    ].filter(Boolean) as string[],
    enableAdmin: isAdminEnabled(),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null
  };
}

export function publicSupabaseEnvErrorMessage() {
  const status = getPublicSupabaseEnvStatus();
  if (status.missing.length === 0) return null;
  return `Supabase公開接続情報が未設定です。missing ${status.missing.join(", ")}`;
}

export function getSupabaseRead() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const envError = publicSupabaseEnvErrorMessage();
  if (envError) throw new Error(envError);
  return createClient(url!, anon!, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
}

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  }
  return createClient(url, serviceRole, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
}

export function getSupabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon);
}

export function isAdminEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_ADMIN === "true";
}

export function assertAdminRequest(request?: Request) {
  if (!isAdminEnabled()) {
    throw new AdminAuthError("管理機能は無効です。", 403);
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) {
    const auth = request?.headers.get("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const headerToken = request?.headers.get("x-admin-token") ?? "";
    if (bearer !== adminToken && headerToken !== adminToken) {
      throw new AdminAuthError("管理トークンが無効です。", 403);
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AdminAuthError("管理用Supabase接続情報が未設定です。", 403);
  }
}

export class AdminAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

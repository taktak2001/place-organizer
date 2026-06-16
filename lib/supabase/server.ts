import { createClient } from "@supabase/supabase-js";

export function getSupabaseRead() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL または NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。");
  }
  return createClient(url, anon, {
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

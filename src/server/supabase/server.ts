import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import {
  getServerRuntimeConfig,
  type ServerRuntimeConfig,
} from "@/server/config";

export class SupabaseAuthConfigurationError extends Error {
  constructor() {
    super("Supabase Authのサーバー設定が不足しています。");
    this.name = "SupabaseAuthConfigurationError";
  }
}

export type CreateSupabaseServerClientOptions = {
  config?: ServerRuntimeConfig;
  responseHeaders?: Headers;
};

function applyResponseHeaders(
  target: Headers | undefined,
  headers: Record<string, string>,
): void {
  if (!target) return;
  for (const [name, value] of Object.entries(headers)) {
    target.set(name, value);
  }
}

export async function createSupabaseServerClient(
  options: CreateSupabaseServerClientOptions = {},
) {
  const config = options.config ?? getServerRuntimeConfig();
  const { url, publishableKey } = config.supabase;
  if (!url || !publishableKey) throw new SupabaseAuthConfigurationError();

  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        try {
          for (const { name, value, options: cookieOptions } of cookiesToSet) {
            cookieStore.set(name, value, cookieOptions as CookieOptions);
          }
        } catch (error) {
          // Server Components cannot write cookies. Proxy refreshes them before
          // rendering; Route Handlers pass responseHeaders and must not hide a
          // failed write.
          if (options.responseHeaders) throw error;
        }
        applyResponseHeaders(options.responseHeaders, headers);
      },
    },
  });
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { ClaimsAuthClient } from "./contracts";

export type SupabaseProxyCredentials = {
  url: string;
  publishableKey: string;
};

type ProxyCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

type ProxyClientOptions = {
  cookies: {
    getAll(): { name: string; value: string }[];
    setAll(cookiesToSet: ProxyCookie[], headers: Record<string, string>): void;
  };
};

export type SupabaseProxyClientFactory = (
  url: string,
  publishableKey: string,
  options: ProxyClientOptions,
) => ClaimsAuthClient;

const defaultClientFactory: SupabaseProxyClientFactory = (
  url,
  publishableKey,
  options,
) => createServerClient(url, publishableKey, options);

export async function updateSupabaseSession(
  request: NextRequest,
  credentials: SupabaseProxyCredentials | null,
  createClient: SupabaseProxyClientFactory = defaultClientFactory,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (!credentials) return response;

  const client = createClient(credentials.url, credentials.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // Keep this immediately after client creation. It verifies the JWT and may
  // refresh cookies before a response is committed. It never creates a user.
  await client.auth.getClaims();

  return response;
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  ConnectionNotice,
  SiteFooter,
  SiteHeader,
} from "@/components/site-shell";
import { getPublicRuntimeConfig } from "@/server/config";

import "./globals.css";

export function generateMetadata(): Metadata {
  const config = getPublicRuntimeConfig();
  const indexable =
    config.environment === "production" && config.publication.ready;

  return {
    title: {
      default: "えまのわ",
      template: "%s | えまのわ",
    },
    description: "みんなの願いが集まる、オンライン絵馬。",
    ...(indexable
      ? {}
      : {
          robots: {
            index: false,
            follow: false,
            noarchive: true,
            noimageindex: true,
            nosnippet: true,
          },
        }),
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          本文へ移動
        </a>
        <SiteHeader />
        <ConnectionNotice />
        <main className="main" id="main-content">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  ConnectionNotice,
  SiteFooter,
  SiteHeader,
} from "@/components/site-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "えまのわ",
    template: "%s | えまのわ",
  },
  description: "みんなの願いが集まる、オンライン絵馬。",
};

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

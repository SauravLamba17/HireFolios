import type { Metadata } from "next";
import { BrowserNotice } from "@/components/browser-notice";
import { brand } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  applicationName: brand.name,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        <BrowserNotice />
        {children}
      </body>
    </html>
  );
}

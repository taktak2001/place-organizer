import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ja } from "@/lib/i18n/ja";
import { isAdminEnabled } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Place Organizer",
  description: "Google Takeoutから保存場所を取り込み、分類・地域整理するアプリ",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Place Organizer",
    statusBarStyle: "default"
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#303841"
};

const navItems = [
  { href: "/", label: "ホーム" },
  { href: "/places", label: ja.nav.places },
  { href: "/categories", label: "カテゴリ一覧" },
  { href: "/review", label: ja.nav.review },
  { href: "/tag-review", label: "タグレビュー" },
  { href: "/restaurant-review", label: "Restaurantレビュー" },
  { href: "/closed", label: ja.nav.closed },
  { href: "/imports", label: ja.nav.imports }
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const adminEnabled = isAdminEnabled();
  const items = navItems.filter((item) => adminEnabled || !["/review", "/tag-review", "/restaurant-review", "/closed", "/imports"].includes(item.href));
  return (
    <html lang="ja">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-line bg-paper/90">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4">
              <Link href="/" className="text-xl font-semibold tracking-normal text-ink">
                Place Organizer
              </Link>
              <nav className="hidden gap-2 text-sm md:flex">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-stone-700 hover:bg-white hover:text-ink"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <details className="relative md:hidden">
                <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-line bg-white text-sm font-semibold">
                  <span className="sr-only">メニュー</span>
                  <span aria-hidden="true">☰</span>
                </summary>
                <nav className="absolute right-0 z-20 mt-2 grid min-w-44 gap-1 rounded-lg border border-line bg-white p-2 text-sm shadow-lg">
                  {items.map((item) => (
                    <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-stone-700 hover:bg-paper hover:text-ink">
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </details>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

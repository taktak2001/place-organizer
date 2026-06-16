import type { Metadata } from "next";
import Link from "next/link";
import { ja } from "@/lib/i18n/ja";
import "./globals.css";

export const metadata: Metadata = {
  title: "Place Organizer",
  description: "Google Takeoutから保存場所を取り込み、分類・地域整理するアプリ"
};

const navItems = [
  { href: "/", label: ja.nav.dashboard },
  { href: "/places", label: ja.nav.places },
  { href: "/review", label: ja.nav.review },
  { href: "/closed", label: ja.nav.closed },
  { href: "/imports", label: ja.nav.imports }
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-stone-300 bg-paper/90">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
              <Link href="/" className="text-xl font-semibold tracking-normal text-ink">
                Place Organizer
              </Link>
              <nav className="flex gap-2 text-sm">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-stone-700 hover:bg-white hover:text-ink"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

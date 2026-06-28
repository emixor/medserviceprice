import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MedServicePrice.kz — Сравнение цен на медицинские услуги",
  description:
    "Агрегатор и сравнение цен на медицинские услуги в Казахстане. Найдите лучшую цену на анализы, приёмы врачей и диагностику.",
  keywords: [
    "медицинские услуги",
    "цены",
    "Казахстан",
    "анализы",
    "клиники",
    "MedServicePrice",
    "сравнение цен",
  ],
  authors: [{ name: "MedServicePrice.kz" }],
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%230d9488'/%3E%3Cpath d='M50 22v56M22 50h56' stroke='white' stroke-width='10' stroke-linecap='round'/%3E%3C/svg%3E",
  },
  openGraph: {
    title: "MedServicePrice.kz",
    description: "Сравнение цен на медицинские услуги в Казахстане",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

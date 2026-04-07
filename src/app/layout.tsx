import type { Metadata } from "next";
import { Inter, Syne } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-syne",
});

export const metadata: Metadata = {
  title: "FormAI",
  description: "Your premium training dashboard",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.className} ${syne.variable}`}>
      <body>{children}</body>
    </html>
  );
}

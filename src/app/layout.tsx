import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Next + Supabase Auth",
  description: "Next.js App Router with Supabase email/password auth",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "./prisma-theme.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prisma News | Painel de notificações",
  description: "Painel interno para distribuição editorial de notificações Prisma News.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

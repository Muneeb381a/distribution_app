import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { urdu } from "@/lib/fonts";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Distribution App",
  description: "Rice and bottle distribution management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${urdu.variable}`}>
      <body>{children}</body>
    </html>
  );
}

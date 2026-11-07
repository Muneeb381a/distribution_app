import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { LOOK_BOOT } from "@/lib/lookBoot";
import { urdu } from "@/lib/fonts";

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Inline, so the saved theme is applied before the first paint.
const THEME_BOOT = `try{var t=localStorage.getItem('dist.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export const metadata: Metadata = {
  title: "Distribution",
  description: "Rice and bottle distribution management",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Distribution", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1110" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-side-tone="dark" className={`${sans.variable} ${urdu.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT + LOOK_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

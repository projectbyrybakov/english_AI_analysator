import type { Metadata, Viewport } from "next";

import { TopBar } from "@/components/TopBar";

import "./globals.css";

export const metadata: Metadata = {
  title: "English Interview Analyst",
  description: "Разбор занятий английским и подготовка к собеседованиям на Data Analyst",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Тема ставится до отрисовки, чтобы не было вспышки светлого фона.
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <TopBar />
        <main id="top">{children}</main>
      </body>
    </html>
  );
}

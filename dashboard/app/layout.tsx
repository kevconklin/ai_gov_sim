import type { Metadata } from "next";
import "@fontsource-variable/public-sans";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI governance reviews",
  robots: { index: false, follow: false },
};

/** Applies the saved theme (or the system theme) before paint. */
const themeScript = `(function(){try{var t=localStorage.getItem('gsim-theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

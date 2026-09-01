import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono, Noto_Serif_SC, Source_Serif_4 } from "next/font/google";
import { BootSkeleton } from "@/components/BootSkeleton";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

// Display serif pair for the warm-humanistic heading voice: Source Serif 4
// covers latin, Noto Serif SC covers CJK. Both expose CSS variables consumed
// by --font-serif in globals.css.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

const notoSerifSC = Noto_Serif_SC({
  // CJK glyphs are served via unicode-range slices regardless of subset;
  // "latin" satisfies next/font's preloading requirement.
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-noto-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "omp web",
  description: "Web UI for the oh-my-pi (omp) coding agent",
  // PWA-like behavior on iOS: standalone chrome, no telephone autodetect.
  appleWebApp: {
    capable: true,
    title: "omp web",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

// theme-color adapts to light/dark so the browser chrome / iOS status bar
// matches the active theme. `viewportFit: cover` lets us honor safe-area-inset
// (used by DirectoryPicker footer) on notched devices.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F6" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1916" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} ${sourceSerif.variable} ${notoSerifSC.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        {/* Pre-hydration: apply stored theme, data-theme, and motion preferences before first paint to avoid flashes */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("omp-theme")||"system";var d=matchMedia("(prefers-color-scheme: dark)").matches;var darkThemes=["dark","oled","nord","dracula","pine","navy","aurora-flow","dawn-flow","cosmic-flow","ocean-flow","sakura-flow","bamboo-flow"];var isD=t==="system"?d:darkThemes.indexOf(t)!==-1;if(isD){document.documentElement.classList.add("dark")}else{document.documentElement.classList.remove("dark")}if(t&&t!=="system"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.removeAttribute("data-theme")}if(t==="custom"){try{var c=JSON.parse(localStorage.getItem("omp-custom-theme"));if(c){var r=document.documentElement;r.style.setProperty("--accent",c.accent);r.style.setProperty("--bg",c.bg);r.style.setProperty("--omp-o",c.accent);r.style.setProperty("--omp-m","color-mix(in srgb, "+c.accent+" 65%, #F59E0B)");r.style.setProperty("--omp-p","color-mix(in srgb, "+c.accent+" 65%, #38BDF8)");r.setAttribute("data-custom-mode",c.mode||"static");if(c.isDark){r.classList.add("dark")}else{r.classList.remove("dark")}}}catch(e){}}else{document.documentElement.removeAttribute("data-custom-mode")}try{var mp=JSON.parse(localStorage.getItem("omp-motion-prefs")||"null");if(mp){var doc=document.documentElement;doc.setAttribute("data-animations",mp.enabled!==false?"true":"false");doc.setAttribute("data-animation-beam",(mp.enabled!==false&&mp.chatBorderBeam!==false)?"true":"false");doc.setAttribute("data-animation-omp",(mp.enabled!==false&&mp.ompBouncing!==false)?"true":"false");doc.setAttribute("data-animation-thinking",(mp.enabled!==false&&mp.thinkingPulse!==false)?"true":"false");if(mp.beamSpeed)doc.style.setProperty("--omp-beam-speed",mp.beamSpeed+"s");}}catch(e){}}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem("omp-lang");if(l!=="en"&&l!=="zh-CN"&&l!=="ja"){var n=(navigator.language||"").toLowerCase();l=n.indexOf("zh")===0?"zh-CN":n.indexOf("ja")===0?"ja":"en"}document.documentElement.lang=l}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {/* Pre-hydration skeleton: page.tsx mounts AppShell via dynamic(ssr:false),
            so before hydration the body is empty and cold starts show pure
            white. BootSkeleton removes itself through React after AppShell
            confirms restoration is ready. */}
        <BootSkeleton />
        {children}
      </body>
    </html>
  );
}

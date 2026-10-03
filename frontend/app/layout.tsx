import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { LangSync } from "@/components/lang-sync";
import { MotionProvider } from "@/components/motion-provider";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin", "latin-ext"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin", "latin-ext"] });
const serif = Fraunces({ variable: "--font-serif", subsets: ["latin", "latin-ext"], axes: ["opsz", "SOFT"] });

export const metadata: Metadata = {
  title: "TripAI: where and when to go",
  description: "Tell us who you are and when you're free. TripAI tells you where and when to go, and shows its working.",
};

export const viewport: Viewport = {
  themeColor: "#f4efe6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable} antialiased`}>
      <body className="min-h-dvh">
        {/* Phone-width column: the app is designed and demoed at mobile size. */}
        <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col bg-paper sm:my-6 sm:min-h-[calc(100dvh-3rem)] sm:overflow-clip sm:rounded-[2.25rem] sm:shadow-[0_30px_80px_-30px_oklch(0.3_0.04_80/0.45)] sm:ring-1 sm:ring-line">
          <MotionProvider>
            <LangSync />
            {children}
          </MotionProvider>
        </div>
      </body>
    </html>
  );
}

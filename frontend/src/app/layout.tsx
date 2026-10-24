import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { AssistantProvider } from "@/components/assistant/AssistantContext";
import { AppShell } from "@/components/AppShell";
import { ToastProvider } from "@/components/toast";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TenjiCheck", template: "%s · TenjiCheck" },
  description: "Pre-handover tactile paving screening, site surveys and accessibility issue reporting. AI proposes; humans decide.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#26292c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className="font-sans text-ink-900 antialiased">
        <AuthProvider>
          <ToastProvider>
            <AssistantProvider>
              <AppShell>{children}</AppShell>
            </AssistantProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

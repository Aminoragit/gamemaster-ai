import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import FirebaseInit from "@/components/FirebaseInit";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GameMaster AI — the AI-run tabletop RPG",
  description:
    "A multiplayer tabletop RPG run by an AI game master, powered by hybrid on-device + cloud inference with Firebase AI Logic.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0a0f] text-neutral-100">
        <FirebaseInit />
        {children}
      </body>
    </html>
  );
}

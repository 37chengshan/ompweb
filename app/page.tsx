"use client";

import dynamic from "next/dynamic";

const AppShell = dynamic(() => import("@/components/AppShell").then((m) => m.AppShell), {
  ssr: false,
});

export default function Home() {
  return <AppShell />;
}


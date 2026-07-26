import { AppShell } from "@/components/AppShell";

/**
 * The whole app is one screen. It's a client component because everything on it
 * is interactive and coordinate-driven — there's no meaningful server render to
 * do when the first thing that happens is "restore the pin from localStorage".
 */
export default function Page() {
  return <AppShell />;
}

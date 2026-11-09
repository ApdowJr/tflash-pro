import type { Metadata } from "next";
import { NotFoundState } from "@/components/app/not-found-state";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return <NotFoundState />;
}

"use client";

import { cn } from "@/lib/utils";
import type { ElementType } from "react";
import { memo } from "react";

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

/**
 * Lightweight pending-text treatment. Kept for the shared AI elements API;
 * implemented in CSS so rendering a response does not require a motion runtime.
 */
const ShimmerComponent = ({ children, as: Component = "span", className }: TextShimmerProps) => (
  <Component className={cn("tf-shimmer", className)}>{children}</Component>
);

export const Shimmer = memo(ShimmerComponent);

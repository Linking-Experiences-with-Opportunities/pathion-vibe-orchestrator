import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isProductionMode(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getQuestionNumberFromPath(pathname: string) {
  const arr = pathname.split("/")
  return arr[arr.length - 1]
}

export function getLessonNumberFromPath(pathname: string) {
  const arr = pathname.split("/")
  return arr[arr.length - 1]
}

export function getFirstPathName(pathname: string) {
  const arr = pathname.split("/")
  if (arr.length < 2) return ""
  return arr[1]
}

export const getS3Url = (input: string) => {
  const cloudFrontBaseUrl =
    process.env.NEXT_PUBLIC_CLOUDFRONT_BASE_URL ||
    "https://d158alpjmt7vrd.cloudfront.net";

  if (!input) return input;

  // 1. If already a CloudFront URL, return as-is
  if (input.startsWith(cloudFrontBaseUrl)) {
    return input;
  }

  // 2. If it's an S3 URL, strip to pathname
  if (input.startsWith("https://") && input.includes(".amazonaws.com")) {
    const url = new URL(input);
    return `${cloudFrontBaseUrl}${url.pathname}`;
  }

  // 3. Otherwise treat as object path
  const normalizedPath = input.startsWith("/") ? input : `/${input}`;

  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${cloudFrontBaseUrl}${encodedPath}`;
};
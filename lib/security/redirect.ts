/** Accept only an application-relative path; never redirect to another origin. */
export function safeLocalPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return "/";
  }
  return value;
}

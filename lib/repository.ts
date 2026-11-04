const PUBLIC_GIT_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

/** Only credential-free public HTTPS repository URLs are accepted by clone. */
export function normalizeRepositoryUrl(value: string): string {
  if (value.length > 500) throw new Error("The repository URL is too long.");
  const url = new URL(value);
  if (url.protocol !== "https:" || !PUBLIC_GIT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Use a public HTTPS repository on GitHub, GitLab, or Bitbucket.");
  }
  if (url.username || url.password || url.search || url.hash || url.port) {
    throw new Error("Repository credentials, ports, query strings, and fragments are not allowed.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Enter a complete owner/repository URL.");
  }
  url.pathname = `/${segments.join("/")}`.replace(/\/$/, "");
  return url.toString();
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

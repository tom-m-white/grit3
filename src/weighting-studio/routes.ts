const BASE_URL = import.meta.env.BASE_URL || "/";

export function appPath(path = ""): string {
  const normalizedPath = path === "/" ? "" : path.replace(/^\/+/, "");
  return `${BASE_URL}${normalizedPath}`;
}

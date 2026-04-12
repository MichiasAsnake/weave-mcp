export type VersionBumpLevel = "patch" | "minor" | "major";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(version: string): SemVer {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function formatSemVer(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function bumpVersion(version: string, level: VersionBumpLevel): string {
  const parsed = parseSemVer(version);

  switch (level) {
    case "major":
      return formatSemVer({
        major: parsed.major + 1,
        minor: 0,
        patch: 0,
      });
    case "minor":
      return formatSemVer({
        major: parsed.major,
        minor: parsed.minor + 1,
        patch: 0,
      });
    case "patch":
    default:
      return formatSemVer({
        major: parsed.major,
        minor: parsed.minor,
        patch: parsed.patch + 1,
      });
  }
}

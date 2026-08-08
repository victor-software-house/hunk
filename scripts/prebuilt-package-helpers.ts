#!/usr/bin/env bun

import os from "node:os";
import path from "node:path";

export type SupportedPlatform = "darwin" | "linux" | "windows";
export type SupportedArch = "x64" | "arm64";

export interface PlatformPackageSpec {
  packageName: string;
  artifactName: string;
  enabled: boolean;
  os: SupportedPlatform;
  cpu: SupportedArch;
  binaryName: string;
  binaryRelativePath: string;
}

const PLATFORM_NAME_MAP: Partial<Record<NodeJS.Platform, SupportedPlatform>> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

const ARCH_NAME_MAP: Partial<Record<NodeJS.Architecture, SupportedArch>> = {
  x64: "x64",
  arm64: "arm64",
};

/** Platforms published as optional prebuilt binary packages. */
export const PLATFORM_PACKAGE_MATRIX: PlatformPackageSpec[] = [
  {
    packageName: "@victor-software-house/hunk-darwin-arm64",
    artifactName: "hunk-darwin-arm64",
    enabled: true,
    os: "darwin",
    cpu: "arm64",
    binaryName: "hunk",
    binaryRelativePath: "bin/hunk",
  },
  {
    packageName: "@victor-software-house/hunk-darwin-x64",
    artifactName: "hunk-darwin-x64",
    enabled: false,
    os: "darwin",
    cpu: "x64",
    binaryName: "hunk",
    binaryRelativePath: "bin/hunk",
  },
  {
    packageName: "@victor-software-house/hunk-linux-arm64",
    artifactName: "hunk-linux-arm64",
    enabled: false,
    os: "linux",
    cpu: "arm64",
    binaryName: "hunk",
    binaryRelativePath: "bin/hunk",
  },
  {
    packageName: "@victor-software-house/hunk-linux-x64",
    artifactName: "hunk-linux-x64",
    enabled: true,
    os: "linux",
    cpu: "x64",
    binaryName: "hunk",
    binaryRelativePath: "bin/hunk",
  },
  {
    packageName: "@victor-software-house/hunk-windows-x64",
    artifactName: "hunk-windows-x64",
    enabled: false,
    os: "windows",
    cpu: "x64",
    binaryName: "hunk",
    binaryRelativePath: "bin/hunk.exe",
  },
] as const;

/** Platform packages enabled for VSH CI and release. */
export function enabledPlatformPackageSpecs() {
  return PLATFORM_PACKAGE_MATRIX.filter((spec) => spec.enabled);
}

/** Normalize a Node platform string into Hunk's package naming vocabulary. */
export function normalizeHostPlatform(platform: NodeJS.Platform) {
  return PLATFORM_NAME_MAP[platform];
}

/** Normalize a Node architecture string into Hunk's package naming vocabulary. */
export function normalizeHostArch(arch: NodeJS.Architecture) {
  return ARCH_NAME_MAP[arch];
}

/** Find one known prebuilt package spec by package name. */
export function getPlatformPackageSpecByName(packageName: string) {
  return PLATFORM_PACKAGE_MATRIX.find((candidate) => candidate.packageName === packageName);
}

/** Resolve the published package spec for a given Node platform/architecture pair. */
export function getPlatformPackageSpecForHost(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
) {
  const normalizedPlatform = normalizeHostPlatform(platform);
  if (!normalizedPlatform) {
    throw new Error(`Unsupported host platform for prebuilt packaging: ${platform}`);
  }

  const normalizedArch = normalizeHostArch(arch);
  if (!normalizedArch) {
    throw new Error(`Unsupported host architecture for prebuilt packaging: ${arch}`);
  }

  const spec = PLATFORM_PACKAGE_MATRIX.find(
    (candidate) => candidate.os === normalizedPlatform && candidate.cpu === normalizedArch,
  );
  if (!spec) {
    throw new Error(
      `No published prebuilt package spec matches ${normalizedPlatform}/${normalizedArch}`,
    );
  }

  return spec;
}

/** Return the Hunk package spec that matches the current machine. */
export function getHostPlatformPackageSpec() {
  return getPlatformPackageSpecForHost(os.platform(), os.arch());
}

/** Build the optional dependency map for the top-level scoped Hunk package. */
export function buildOptionalDependencyMap(
  version: string,
  specs: readonly PlatformPackageSpec[] = enabledPlatformPackageSpecs(),
) {
  return Object.fromEntries(specs.map((spec) => [spec.packageName, version]));
}

/** Return the executable filename for a platform package. */
export function binaryFilenameForSpec(spec: PlatformPackageSpec) {
  return spec.os === "windows" ? `${spec.binaryName}.exe` : spec.binaryName;
}

/**
 * Build the published manifest for one prebuilt platform package.
 *
 * Platform packages are implementation dependencies, so their native executables
 * stay out of `bin`; npm 11 rejects native files there as invalid scripts. The
 * staged executable bit and top-level wrapper preserve direct execution instead.
 */
export function buildPlatformPackageManifest(
  rootPackage: {
    version: string;
    description?: string;
    repository?: unknown;
    homepage?: string;
    bugs?: unknown;
    license?: string;
  },
  spec: PlatformPackageSpec,
) {
  return {
    name: spec.packageName,
    version: rootPackage.version,
    description: `${rootPackage.description} (${spec.os} ${spec.cpu} binary)`,
    os: [spec.os === "windows" ? "win32" : spec.os],
    cpu: [spec.cpu],
    files: ["bin", "LICENSE"],
    repository: rootPackage.repository,
    homepage: rootPackage.homepage,
    bugs: rootPackage.bugs,
    license: rootPackage.license,
    publishConfig: {
      registry: "https://npm.pkg.github.com",
      access: "restricted",
    },
  };
}

/** Resolve a path under the generated prebuilt npm release directory. */
export function releaseNpmDir(repoRoot: string) {
  return path.join(repoRoot, "dist", "release", "npm");
}

/** Resolve a path under the generated prebuilt binary artifact directory. */
export function releaseArtifactsDir(repoRoot: string) {
  return path.join(repoRoot, "dist", "release", "artifacts");
}

/** Sort package specs into stable package publish order. */
export function sortPlatformPackageSpecs(specs: readonly PlatformPackageSpec[]) {
  return [...specs].sort((left, right) => left.packageName.localeCompare(right.packageName));
}

/** Require a package-set retry to see either no versions or the complete set. */
export function classifyPackageSetPublication(
  packages: readonly { name: string; version: string; exists: boolean }[],
): "none" | "all" {
  const existing = packages.filter((entry) => entry.exists);
  if (existing.length > 0 && existing.length < packages.length) {
    throw new Error(
      `Partial GitHub Packages release detected: ${existing
        .map((entry) => `${entry.name}@${entry.version}`)
        .join(", ")} already exist, but the complete set has ${packages.length} packages.`,
    );
  }
  return existing.length === packages.length ? "all" : "none";
}

import { describe, expect, test } from "bun:test";
import {
  PLATFORM_PACKAGE_MATRIX,
  binaryFilenameForSpec,
  buildOptionalDependencyMap,
  buildPlatformPackageManifest,
  buildPublishArgs,
  classifyPackageSetPublication,
  enabledPlatformPackageSpecs,
  getHostPlatformPackageSpec,
  getPlatformPackageSpecByName,
  getPlatformPackageSpecForHost,
  normalizeHostArch,
  normalizeHostPlatform,
  sortPlatformPackageSpecs,
  type PlatformPackageSpec,
} from "./prebuilt-package-helpers";

describe("prebuilt package helpers", () => {
  test("buildOptionalDependencyMap includes only enabled platform packages at one version", () => {
    const version = "9.9.9";
    const dependencies = buildOptionalDependencyMap(version);

    expect(Object.keys(dependencies).sort()).toEqual(
      enabledPlatformPackageSpecs()
        .map((spec) => spec.packageName)
        .sort(),
    );
    expect(new Set(Object.values(dependencies))).toEqual(new Set([version]));
  });

  test("enables only macOS arm64 and Linux x64 release targets", () => {
    expect(enabledPlatformPackageSpecs().map((spec) => [spec.os, spec.cpu])).toEqual([
      ["darwin", "arm64"],
      ["linux", "x64"],
    ]);
    expect(PLATFORM_PACKAGE_MATRIX.filter((spec) => !spec.enabled)).toHaveLength(3);
  });

  test("binaryFilenameForSpec keeps unix package binaries extensionless", () => {
    for (const spec of PLATFORM_PACKAGE_MATRIX) {
      if (spec.os === "windows") {
        continue;
      }
      expect(binaryFilenameForSpec(spec)).toBe("hunk");
    }
  });

  test("binaryFilenameForSpec adds .exe for windows packages", () => {
    const windowsSpec: PlatformPackageSpec = {
      packageName: "@victor-software-house/hunk-windows-x64",
      artifactName: "hunk-windows-x64",
      enabled: false,
      os: "windows",
      cpu: "x64",
      binaryName: "hunk",
      binaryRelativePath: "bin/hunk.exe",
    };

    expect(binaryFilenameForSpec(windowsSpec)).toBe("hunk.exe");
  });

  test("normalizeHostPlatform and normalizeHostArch reject unsupported values", () => {
    expect(normalizeHostPlatform("linux")).toBe("linux");
    expect(normalizeHostPlatform("win32")).toBe("windows");
    expect(normalizeHostPlatform("freebsd" as NodeJS.Platform)).toBeUndefined();

    expect(normalizeHostArch("x64")).toBe("x64");
    expect(normalizeHostArch("arm64")).toBe("arm64");
    expect(normalizeHostArch("ia32" as NodeJS.Architecture)).toBeUndefined();
  });

  test("getPlatformPackageSpecByName returns known package specs", () => {
    expect(getPlatformPackageSpecByName("@victor-software-house/hunk-linux-x64")?.cpu).toBe("x64");
    expect(getPlatformPackageSpecByName("@victor-software-house/hunk-darwin-arm64")?.os).toBe(
      "darwin",
    );
    expect(
      getPlatformPackageSpecByName("@victor-software-house/hunk-does-not-exist"),
    ).toBeUndefined();
  });

  test("getPlatformPackageSpecForHost resolves recorded combinations and rejects unknown ones", () => {
    expect(getPlatformPackageSpecForHost("linux", "x64").packageName).toBe(
      "@victor-software-house/hunk-linux-x64",
    );
    expect(getPlatformPackageSpecForHost("darwin", "arm64").packageName).toBe(
      "@victor-software-house/hunk-darwin-arm64",
    );
    expect(() => getPlatformPackageSpecForHost("freebsd" as NodeJS.Platform, "x64")).toThrow(
      "Unsupported host platform for prebuilt packaging: freebsd",
    );
    expect(() => getPlatformPackageSpecForHost("linux", "ia32" as NodeJS.Architecture)).toThrow(
      "Unsupported host architecture for prebuilt packaging: ia32",
    );
    expect(getPlatformPackageSpecForHost("linux", "arm64").enabled).toBe(false);
    expect(getPlatformPackageSpecForHost("win32", "x64").enabled).toBe(false);
  });

  test("getHostPlatformPackageSpec resolves the current machine", () => {
    expect(getHostPlatformPackageSpec()).toEqual(
      getPlatformPackageSpecForHost(process.platform, process.arch),
    );
  });

  test("buildPlatformPackageManifest carries provenance metadata without a native bin script", () => {
    const repository = {
      type: "git",
      url: "git+https://github.com/victor-software-house/hunk.git",
    };
    const manifest = buildPlatformPackageManifest(
      {
        version: "1.2.3",
        description: "Desktop diff viewer",
        repository,
        homepage: "https://github.com/victor-software-house/hunk#readme",
        bugs: { url: "https://github.com/victor-software-house/hunk/issues" },
        license: "MIT",
      },
      getPlatformPackageSpecForHost("linux", "x64"),
    );

    expect(manifest.name).toBe("@victor-software-house/hunk-linux-x64");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest).not.toHaveProperty("bin");
    expect(manifest.repository).toEqual(repository);
    expect(manifest.homepage).toBe("https://github.com/victor-software-house/hunk#readme");
    expect(manifest.bugs).toEqual({ url: "https://github.com/victor-software-house/hunk/issues" });
    expect(manifest.os).toEqual(["linux"]);
    expect(manifest.cpu).toEqual(["x64"]);
    expect(manifest.publishConfig).toEqual({
      registry: "https://npm.pkg.github.com",
      access: "restricted",
    });
  });

  test("buildPlatformPackageManifest maps Windows packages to npm win32", () => {
    const manifest = buildPlatformPackageManifest(
      {
        version: "1.2.3",
        description: "Desktop diff viewer",
        license: "MIT",
      },
      getPlatformPackageSpecForHost("win32", "x64"),
    );

    expect(manifest.name).toBe("@victor-software-house/hunk-windows-x64");
    expect(manifest).not.toHaveProperty("bin");
    expect(manifest.os).toEqual(["win32"]);
    expect(manifest.cpu).toEqual(["x64"]);
  });

  test("buildPublishArgs carries the repository auth config into staged package directories", () => {
    expect(
      buildPublishArgs({
        bunConfigPath: "/repo/bunfig.toml",
        dryRun: true,
        npmTag: "beta",
      }),
    ).toEqual([
      "--config",
      "/repo/bunfig.toml",
      "publish",
      "--tolerate-republish",
      "--access",
      "restricted",
      "--tag",
      "beta",
      "--dry-run",
    ]);
    expect(
      buildPublishArgs({
        bunConfigPath: "/repo/bunfig.toml",
        dryRun: false,
        npmTag: "latest",
      }),
    ).not.toContain("--dry-run");
  });

  test("classifyPackageSetPublication rejects partial releases", () => {
    const packages = [
      { name: "@victor-software-house/hunk-darwin-arm64", version: "1.2.3", exists: true },
      { name: "@victor-software-house/hunk-linux-x64", version: "1.2.3", exists: false },
      { name: "@victor-software-house/hunk", version: "1.2.3", exists: false },
    ];

    expect(() => classifyPackageSetPublication(packages)).toThrow(
      "Partial GitHub Packages release detected",
    );
    expect(
      classifyPackageSetPublication(packages.map((entry) => ({ ...entry, exists: false }))),
    ).toBe("none");
    expect(
      classifyPackageSetPublication(packages.map((entry) => ({ ...entry, exists: true }))),
    ).toBe("all");
  });

  test("sortPlatformPackageSpecs keeps package publish order stable", () => {
    const reversed = [...PLATFORM_PACKAGE_MATRIX].reverse();
    expect(sortPlatformPackageSpecs(reversed).map((spec) => spec.packageName)).toEqual([
      "@victor-software-house/hunk-darwin-arm64",
      "@victor-software-house/hunk-darwin-x64",
      "@victor-software-house/hunk-linux-arm64",
      "@victor-software-house/hunk-linux-x64",
      "@victor-software-house/hunk-windows-x64",
    ]);
  });
});

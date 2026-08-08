import githubChangelog from "@changesets/changelog-github";

const upstreamPullLink =
  /\[#(\d+)\]\(https:\/\/github\.com\/modem-dev\/hunk\/(?:pull|issues)\/\1\)/g;

/** Preserve upstream PR numbers as provenance without linking VSH releases to the upstream repository. */
export function normalizeVshChangelog(markdown: string): string {
  return markdown.replace(upstreamPullLink, "#$1");
}

const changelog = {
  async getReleaseLine(...args: Parameters<typeof githubChangelog.getReleaseLine>) {
    return normalizeVshChangelog(await githubChangelog.getReleaseLine(...args));
  },
  async getDependencyReleaseLine(
    ...args: Parameters<typeof githubChangelog.getDependencyReleaseLine>
  ) {
    return normalizeVshChangelog(await githubChangelog.getDependencyReleaseLine(...args));
  },
} satisfies typeof githubChangelog;

export default changelog;

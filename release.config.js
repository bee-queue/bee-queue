module.exports = {
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    [
      '@semantic-release/release-notes-generator',
      { preset: 'conventionalcommits' },
    ],
    '@semantic-release/github',
    ['@semantic-release/changelog', { changelogFile: 'HISTORY.md' }],
    [
      '@semantic-release/exec',
      { prepareCmd: 'npx prettier --write HISTORY.md' },
    ],
    '@semantic-release/npm',
    [
      '@semantic-release/git',
      { assets: ['HISTORY.md', 'package.json', 'package-lock.json'] },
    ],
  ],
};

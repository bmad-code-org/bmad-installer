# Releasing

Bump the version in `package.json`: `npm version prerelease --preid next` for a `-next` build, or `npm version minor` (or `major`/`patch`) for a stable release. This creates a commit and a tag `vX.Y.Z`.

Push the tag: `git push origin vX.Y.Z`. The `publish.yml` workflow runs on that push and publishes to npm under the `next` dist-tag with provenance.

Once you've verified the published version works, move the `latest` dist-tag by hand: `npm dist-tag add bmad-method@X.Y.Z latest`.

The npm trusted publisher for this package must point at `bmad-code-org/bmad-installer`; if it points anywhere else, `npm publish --provenance` in the workflow fails.

# Publishing `narcisbodea/smstunnel-action` to the GitHub Marketplace

## The name

`action.yml` names the action **SMSTunnel SMS**. The Marketplace requires a name that no other listed action uses,
that is not a GitHub user or organization (other than the publisher), not a Marketplace category, and not one of
GitHub's own features. On 1 November 2026 a Marketplace search for "smstunnel" found nothing, no GitHub account is
called `smstunnel`, and the name puts our brand first without "GitHub" in it, so it doesn't suggest that GitHub makes
or endorses the action. The README says it is not affiliated with GitHub. Its listing will be
`https://github.com/marketplace/actions/smstunnel-sms`.

## What the Marketplace needs

- A **public** repository with a single `action.yml` at its root (this repository).
- **Two-factor authentication** on the publishing account.
- The **GitHub Marketplace Developer Agreement**, accepted once by the account that owns the repository.
- `dist/` committed: the runner runs `dist/index.js` as it is in the tag. CI fails if `dist/` is out of date.

There is no review: a release with the checkbox ticked is listed right away.

## Steps

1. Create the public repository `narcisbodea/smstunnel-action` and push this folder to `main` (`dist/` included).
   Check that the **CI** workflow passes (tests, `dist/` up to date, and the action run against a stand-in API).
2. In the repository, open `action.yml`: GitHub shows a banner offering to publish the action. Click
   **Draft a release** (or **Releases → Draft a new release**).
3. Tick **Publish this Action to the GitHub Marketplace**. The first time, GitHub asks you to accept the
   **Marketplace Developer Agreement**; accept it, come back, and tick the box. Wait for **Everything looks good!**
   (it checks the name, description, icon and color in `action.yml`).
4. **Primary category**: Monitoring. **Another category**: Utilities.
5. **Choose a tag**: type `v1.0.0` and create it on `main`. **Release title**: `v1.0.0`. Paste the changelog entry.
6. **Publish release**.
7. Create the major tag that workflows use (`uses: narcisbodea/smstunnel-action@v1`) on the same commit:

   ```bash
   git fetch --tags
   git tag v1 v1.0.0
   git push origin v1
   ```

## Later versions

1. Change `src/`, run `npm test` and `npm run build`, update `CHANGELOG.md` and `VERSION` in `src/main.js`, commit
   `dist/` with the change.
2. Publish a release `v1.x.y` the same way (the Marketplace box stays ticked).
3. Move `v1` to it: `git tag -f v1 v1.x.y && git push -f origin v1`.
   - A change that breaks existing workflows gets `v2.0.0` and a new `v2` tag instead; `v1` stays where it is.
   - If you turn on **immutable releases** for the repository, keep `v1` as a plain tag (not a release) so it can
     still move, or tell users to pin `@v1.x.y` or a commit SHA.

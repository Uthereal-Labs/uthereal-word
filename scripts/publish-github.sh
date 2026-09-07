#!/usr/bin/env bash
# Push this checkout without rewriting remote history, enable Pages, and verify deployment.
# Requires Git, curl, and an authenticated GitHub CLI. No token is embedded or printed.
set -euo pipefail
export GH_HOST=github.com
export GH_PROMPT_DISABLED=1
export GIT_TERMINAL_PROMPT=0

repository='wieslawsoltes/Quire'
remote_url="https://github.com/${repository}.git"
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
for command in git gh curl; do
  command -v "$command" >/dev/null 2>&1 || fail "Install $command before running this script."
done
gh auth status --hostname github.com >/dev/null 2>&1 ||
  fail 'Authenticate locally first: gh auth login --hostname github.com --git-protocol https --scopes repo,workflow'
[[ "$(git rev-parse --show-toplevel)" == "$root" ]] || fail 'Run from the supplied Quire checkout.'
[[ "$(git symbolic-ref --short HEAD)" == main ]] || fail 'The checked-out branch must be main.'
[[ -z "$(git status --porcelain)" ]] || fail 'Commit or remove local changes before publishing.'
[[ "$(git remote get-url origin)" == "$remote_url" ]] || fail "origin must be $remote_url"
[[ "$(gh api "repos/$repository" --jq '.permissions.push // false')" == true ]] ||
  fail "Your GitHub CLI account cannot push to $repository."
[[ "$(gh api "repos/$repository" --jq '.default_branch')" == main ]] ||
  fail 'The remote default branch is no longer main. Review it before publishing.'

# These credential settings apply only to these commands, not to global Git config.
git_auth() { git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"; }
remote_heads="$(git_auth ls-remote --heads origin)"
if [[ -n "$remote_heads" ]]; then
  printf '%s\n' "$remote_heads" | grep -q $'\trefs/heads/main$' ||
    fail 'The remote has branches but no main branch. No changes were pushed.'
  git_auth fetch origin main
  git merge-base --is-ancestor FETCH_HEAD HEAD ||
    fail 'Remote main has unrelated or newer commits. Review and merge them first; no force push was attempted.'
fi

commit="$(git rev-parse HEAD)"
printf 'Pushing %s to %s/main\n' "$commit" "$repository"
git_auth push --set-upstream origin HEAD:main

scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
pages_endpoint="repos/$repository/pages"
if build_type="$(gh api "$pages_endpoint" --jq '.build_type // ""' 2>"$scratch/pages-error")"; then
  if [[ "$build_type" != workflow ]]; then
    gh api --method PUT "$pages_endpoint" -f build_type=workflow >/dev/null
  fi
else
  if ! grep -q 'HTTP 404' "$scratch/pages-error"; then
    cat "$scratch/pages-error" >&2
    fail 'The commit was pushed, but the Pages settings could not be read.'
  fi
  gh api --method POST "$pages_endpoint" -f build_type=workflow >/dev/null ||
    fail 'The commit was pushed, but enabling Pages failed. Check Pages/administration permissions, then rerun this script.'
fi

runs_endpoint="repos/$repository/actions/workflows/pages.yml/runs?event=workflow_dispatch&head_sha=$commit&per_page=20"
previous_run="$(gh api "$runs_endpoint" --jq '[.workflow_runs[].id] | max // 0' 2>/dev/null || printf '0')"
printf 'GitHub Pages configured. Dispatching deployment.\n'
# A newly pushed workflow can take a moment to become addressable by filename.
for attempt in {1..24}; do
  if gh workflow run pages.yml --repo "$repository" --ref main 2>"$scratch/dispatch-error"; then
    break
  fi
  if [[ "$attempt" == 24 ]] || ! grep -q 'HTTP 404' "$scratch/dispatch-error"; then
    cat "$scratch/dispatch-error" >&2
    fail 'The source is pushed and Pages is configured, but workflow dispatch failed.'
  fi
  sleep 5
done

run_id=''
for attempt in {1..24}; do
  candidate="$(gh api "$runs_endpoint" --jq '[.workflow_runs[].id] | max // 0')"
  if [[ "$candidate" -gt "$previous_run" ]]; then
    run_id="$candidate"
    break
  fi
  sleep 5
done
[[ -n "$run_id" ]] || fail "Deployment was requested, but no run was found. Inspect https://github.com/$repository/actions"
printf 'Deployment run: https://github.com/%s/actions/runs/%s\n' "$repository" "$run_id"
gh run watch "$run_id" --repo "$repository" --exit-status ||
  fail "Deployment did not succeed. Inspect https://github.com/$repository/actions/runs/$run_id"

site_url="$(gh api "$pages_endpoint" --jq '.html_url')"
[[ "$site_url" == https://* ]] || fail 'Deployment succeeded but Pages did not return an HTTPS site URL.'
for attempt in {1..24}; do
  if curl --fail --silent --show-error --location "${site_url}?deployment=${commit}" -o "$scratch/site.html" &&
     grep -qi '<title>Quire' "$scratch/site.html"; then
    printf '\nPublished successfully.\nRepository: https://github.com/%s\nCommit: %s\nApp: %s\n' "$repository" "$commit" "$site_url"
    exit 0
  fi
  sleep 5
done
fail "Deployment succeeded, but the live page could not be verified: $site_url"

# Lfcode GitHub Action

A GitHub Action that runs [Lfcode](https://github.com/lfyxhappy/lfcode) inside your GitHub Actions workflow.

Mention `/lfcode`, `/opencode`, or `/oc` in your comment, and Lfcode will execute tasks inside your GitHub Actions runner.

The workflow file and local CLI now use the `lfcode` name. The hosted GitHub App and docs still live on the OpenCode infrastructure.

## Features

#### Explain an issue

Leave the following comment on a GitHub issue. Lfcode will read the entire thread, including all comments, and reply with a clear explanation.

```
/lfcode explain this issue
```

#### Fix an issue

Leave the following comment on a GitHub issue. Lfcode will create a new branch, implement the changes, and open a PR with the changes.

```
/lfcode fix this
```

#### Review PRs and make changes

Leave the following comment on a GitHub PR. Lfcode will implement the requested change and commit it to the same PR.

```
Delete the attachment from S3 when the note is removed /oc
```

#### Review specific code lines

Leave a comment directly on code lines in the PR's "Files" tab. Lfcode will automatically detect the file, line numbers, and diff context to provide precise responses.

```
[Comment on specific lines in Files tab]
/oc add error handling here
```

When commenting on specific lines, Lfcode receives:

- The exact file being reviewed
- The specific lines of code
- The surrounding diff context
- Line number information

This allows for more targeted requests without needing to specify file paths or line numbers manually.

## Installation

Run the following command in the terminal from your GitHub repo:

```bash
lfcode github install
```

This will walk you through installing the GitHub app, creating the workflow, and setting up secrets.

### Manual Setup

1. Install the GitHub app https://github.com/apps/opencode-agent. Make sure it is installed on the target repository.
2. Add the following workflow file to `.github/workflows/lfcode.yml` in your repo. Set the appropriate `model` and required API keys in `env`.

   ```yml
   name: lfcode

   on:
     issue_comment:
       types: [created]
     pull_request_review_comment:
       types: [created]

   jobs:
     lfcode:
        if: |
          contains(github.event.comment.body, ' /lfcode') ||
          startsWith(github.event.comment.body, '/lfcode') ||
          contains(github.event.comment.body, ' /oc') ||
          startsWith(github.event.comment.body, '/oc') ||
          contains(github.event.comment.body, ' /opencode') ||
          startsWith(github.event.comment.body, '/opencode')
        runs-on: ubuntu-latest
        permissions:
          id-token: write
          contents: read
          pull-requests: read
          issues: read
        steps:
          - name: Checkout repository
            uses: actions/checkout@v6
            with:
              persist-credentials: false

          - name: Run Lfcode
            uses: lfyxhappy/lfcode/github@latest
            env:
              LFCODE_API_KEY: ${{ secrets.LFCODE_API_KEY }}
            with:
              model: opencode/claude-opus-4-5
   ```

3. Store the API keys in secrets. In your organization or project **settings**, expand **Secrets and variables** on the left and select **Actions**. Add the required API keys.
4. Full usage examples and app-install docs currently live at https://opencode.ai/docs/github/.

## Support

This is an early release. If you encounter issues or have feedback, please create an issue at https://github.com/lfyxhappy/lfcode/issues.

## Development

To test locally:

1. Navigate to a test repo (e.g. `hello-world`):

   ```bash
   cd hello-world
   ```

2. Run:

   ```bash
   MODEL=anthropic/claude-sonnet-4-20250514 \
     ANTHROPIC_API_KEY=sk-ant-api03-1234567890 \
     GITHUB_RUN_ID=dummy \
     MOCK_TOKEN=github_pat_1234567890 \
     MOCK_EVENT='{"eventName":"issue_comment",...}' \
     bun /path/to/lfcode/github/index.ts
   ```

   - `MODEL`: The model used by Lfcode. Same as the `MODEL` defined in the GitHub workflow.
   - `ANTHROPIC_API_KEY`: Your model provider API key. Same as the keys defined in the GitHub workflow.
   - `GITHUB_RUN_ID`: Dummy value to emulate GitHub action environment.
   - `MOCK_TOKEN`: A GitHub personal access token. This token is used to verify you have `admin` or `write` access to the test repo. Generate a token [here](https://github.com/settings/personal-access-tokens).
   - `MOCK_EVENT`: Mock GitHub event payload (see templates below).
   - `/path/to/lfcode`: Path to your cloned Lfcode repo. `bun /path/to/lfcode/github/index.ts` runs your local version of Lfcode.

### Issue comment event

```
MOCK_EVENT='{"eventName":"issue_comment","repo":{"owner":"sst","repo":"hello-world"},"actor":"fwang","payload":{"issue":{"number":4},"comment":{"id":1,"body":"/lfcode summarize thread"}}}'
```

Replace:

- `"owner":"sst"` with repo owner
- `"repo":"hello-world"` with repo name
- `"actor":"fwang"` with the GitHub username of commenter
- `"number":4` with the GitHub issue id
- `"body":"/lfcode summarize thread"` with comment body

### Issue comment with image attachment.

```
MOCK_EVENT='{"eventName":"issue_comment","repo":{"owner":"sst","repo":"hello-world"},"actor":"fwang","payload":{"issue":{"number":4},"comment":{"id":1,"body":"/lfcode what is in my image ![Image](https://github.com/user-attachments/assets/xxxxxxxx)"}}}'
```

Replace the image URL `https://github.com/user-attachments/assets/xxxxxxxx` with a valid GitHub attachment (you can generate one by commenting with an image in any issue).

### PR comment event

```
MOCK_EVENT='{"eventName":"issue_comment","repo":{"owner":"sst","repo":"hello-world"},"actor":"fwang","payload":{"issue":{"number":4,"pull_request":{}},"comment":{"id":1,"body":"/lfcode summarize thread"}}}'
```

### PR review comment event

```
MOCK_EVENT='{"eventName":"pull_request_review_comment","repo":{"owner":"sst","repo":"hello-world"},"actor":"fwang","payload":{"pull_request":{"number":7},"comment":{"id":1,"body":"/lfcode add error handling","path":"src/components/Button.tsx","diff_hunk":"@@ -45,8 +45,11 @@\n- const handleClick = () => {\n-   console.log('clicked')\n+ const handleClick = useCallback(() => {\n+   console.log('clicked')\n+   doSomething()\n+ }, [doSomething])","line":47,"original_line":45,"position":10,"commit_id":"abc123","original_commit_id":"def456"}}}'
```

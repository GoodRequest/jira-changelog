# Jira Changelog Generator

Generates a changelog of Jira issues from your git history and, optionally, attaches all issues to a release.

For example:

```bash
jira-changelog --range origin/prod...origin/master
```

```text
Jira Tickets
---------------------

 * <Bug> - Unable to access date widget
   [DEV-1234] https://yoursite.atlassian.net/browse/DEV-1234

 * <Story> - Support left-handed keyboards
   [DEV-5678] https://yoursite.atlassian.net/browse/DEV-5678

Other Commits
---------------------

 * Jeremy - <cd6f512> - Fix typo in welcome message

Pending Approval
---------------------
 ~ None. Yay! ~
```

The script looks for Jira issue keys surrounded by square brackets, such as `[DEV-123]`, in git commit logs. When it finds one, it fetches the Jira issue and adds it to the changelog.

## Installation

```bash
npm install -g @goodrequest/jira-changelog
```

## Jira setup

Create an Atlassian API token for the account that should read Jira issues. By default, this package uses Atlassian API Gateway mode, which supports the newer scoped Jira API tokens and calls Jira at:

```text
https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/...
```

You do not need to provide `cloudId` in normal usage. The tool resolves it from the configured Jira site host:

```text
https://<your-site>.atlassian.net/_edge/tenant_info
```

Read-only changelog generation needs Jira issue read access. The `--release` flow also creates project versions and updates issue `fixVersions`, so that token needs the corresponding write/project permissions.

## Configuration

Create `changelog.config.js` at the root of the git workspace where you run `jira-changelog`.

The GoodRequest reusable changelog workflow passes these environment variables to `npm run changelog`:

```text
JIRA_API_HOST
JIRA_API_USER
JIRA_API_TOKEN
SLACK_BOT_TOKEN
```

A project config can therefore stay small:

```js
module.exports = {
	jira: {
		api: {
			host: process.env.JIRA_API_HOST, // example: 'myapp.atlassian.net'
			email: process.env.JIRA_API_USER,
			token: process.env.JIRA_API_TOKEN
		},
		baseUrl: `https://${process.env.JIRA_API_HOST}`
	},
	slack: {
		apiKey: process.env.SLACK_BOT_TOKEN,
		channel: '#changelogs'
	},
	save: true
}
```

`host` should be your Jira site host, not `api.atlassian.com`. The package builds the API Gateway URL internally and resolves `cloudId` from the host when needed.

If a project intentionally needs the older site-host REST API behavior, opt out explicitly:

```js
module.exports = {
	jira: {
		api: {
			host: process.env.JIRA_API_HOST,
			email: process.env.JIRA_API_USER,
			token: process.env.JIRA_API_TOKEN,
			useApiGateway: false
		},
		baseUrl: `https://${process.env.JIRA_API_HOST}`
	}
}
```

Legacy mode calls Jira directly at:

```text
https://<host>/rest/api/2/...
```

## Usage

```bash
jira-changelog --range origin/prod...origin/master
```

If no range is provided, the `sourceControl.defaultRange` value from `changelog.config.js` is used.

## Releases

You can automatically attach a release to all Jira issues in the changelog with the `--release` flag:

```bash
jira-changelog --release sprint-12
```

This creates the version if necessary and sets `fixVersions` on the included issues.

## Slack

The script can also post the changelog to Slack. Add Slack configuration:

```js
module.exports = {
	// ...
	slack: {
		apiKey: process.env.SLACK_BOT_TOKEN,
		channel: '#changelogs'
	}
}
```

Then run:

```bash
jira-changelog --slack
```

## API

The changelog internals can also be used from Node:

```js
const { Config, SourceControl, Jira } = require('@goodrequest/jira-changelog')

const gitRepoPath = '/home/user/source/'
const config = Config.readConfigFile(gitRepoPath)
const source = new SourceControl(config)
const jira = new Jira(config)

source.getCommitLogs(gitRepoPath, { from: 'origin/prod', to: 'origin/master' }).then((commits) => {
	jira.generate(commits).then((changelog) => {
		console.log(changelog)
	})
})
```

## Custom output

The output is controlled by the EJS template in `changelog.config.js`. You can also define `transformData` and `transformForSlack` functions to customize generated data/content.

var Haikunator = require('haikunator')

function env(name) {
	return process.env[name] || undefined
}

function normalizeHost(host) {
	if (!host) {
		return undefined
	}

	return String(host)
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
}

function toBaseUrl(host) {
	const normalized = normalizeHost(host)
	return normalized ? `https://${normalized}` : 'https://atlassian.net'
}

var jiraHost = env('JIRA_API_HOST') || env('CHANGELOG_JIRA_API_HOST')

module.exports = {
	// Jira integration
	jira: {
		api: {
			// Root host of your Jira Cloud site, without protocol.
			// The GoodRequest reusable changelog workflow provides this as JIRA_API_HOST.
			host: jiraHost,

			// Email address of the Atlassian account used for API access.
			email:
				env('JIRA_API_USER') ||
				env('CHANGELOG_JIRA_API_USER') ||
				env('JIRA_EMAIL') ||
				env('CHANGELOG_JIRA_EMAIL'),

			// Atlassian API token.
			token: env('JIRA_API_TOKEN') || env('CHANGELOG_JIRA_API_TOKEN'),

			// API gateway mode is the default. The tool resolves cloudId from host when omitted.
			// Set useApiGateway: false in a project config only to force legacy site-host API calls.
			cloudId: env('JIRA_API_CLOUD_ID') || env('CHANGELOG_JIRA_API_CLOUD_ID'),
			useApiGateway: true,

			// Set to 2 or 3 to override the default Jira REST API version.
			// Defaults to 3 for API gateway mode and 2 for legacy host mode.
			apiVersion: undefined,

			// Optional fetch headers/options for advanced use cases.
			options: {}
		},

		// Jira base web URL used when rendering links in the changelog.
		baseUrl: env('JIRA_BASE_URL') || env('CHANGELOG_JIRA_BASE_URL') || toBaseUrl(jiraHost),

		// Regex used to match issue keys in commit text.
		// Use capture group one to isolate the key text within surrounding characters.
		ticketIDPattern: /\[([A-Z]+\-[0-9]+)\]/i,

		// Status names that mean the ticket is approved.
		approvalStatus: ['Done', 'Closed', 'Accepted'],

		// Tickets to exclude from the changelog, by Jira issue type name.
		excludeIssueTypes: ['Sub-task', 'Story Bug'],

		// Tickets to include in the changelog, by Jira issue type name.
		// If this is defined, `excludeIssueTypes` is ignored.
		includeIssueTypes: [],

		// Get the release version name to use when using `--release` without a value.
		generateReleaseVersionName: function () {
			const haikunator = new Haikunator()
			return Promise.resolve(haikunator.haikunate())
		}
	},

	// Slack API integration
	slack: {
		// API key string
		apiKey: undefined,

		// Channel used when the `--slack` flag is passed.
		// This can be a channel string ('#mychannel') or a channel ID.
		channel: undefined,

		// The name to give the Slack bot user.
		username: 'Changelog Bot',

		// Emoji to use for the bot icon. Cannot be used with `icon_url`.
		icon_emoji: ':clipboard:',

		// URL to an image to use as the icon. Cannot be used with `icon_emoji`.
		icon_url: undefined
	},

	// Source control settings
	sourceControl: {
		defaultRange: {
			from: 'origin/main',
			to: 'origin/stage',
			// symmetric='...', non-symmetric='..'
			symmetric: false
		}
	},

	// Hide "~ None ~" blocks in the template if set to true.
	hideEmptyBlocks: false,

	// Transform the basic changelog data before it goes to the template.
	transformData: function (data) {
		return Promise.resolve(data)
	},

	// Transform the changelog before posting it to Slack.
	transformForSlack: function (content, data) {
		return Promise.resolve(content)
	},

	// The template that generates the output, as an EJS template.
	template: `<% if (jira.releaseVersions && jira.releaseVersions.length) { %>
Release version: <%= jira.releaseVersions[0].name -%>
<% jira.releaseVersions.forEach((release) => { %>
 * <%= release.projectKey %>: <%= jira.baseUrl + '/projects/' + release.projectKey + '/versions/' + release.id -%>
<% }); -%>

<% } %>
<% blockTickets = tickets.all.filter((t) => !t.reverted); -%>
<% if (blockTickets.length > 0 || !options.hideEmptyBlocks) { -%>
Jira Tickets
---------------------
<% blockTickets.forEach(ticket => { -%>
 * <<%= ticket.fields.issuetype.name %>> - <%- ticket.fields.summary %>
   [<%= ticket.key %>] <%= jira.baseUrl + '/browse/' + ticket.key %>
<% }); -%>
<% if (!blockTickets.length) {%> ~ None ~ <% } %>

<% } -%>
<% blockNoTickets = commits.noTickets; -%>
<% if (blockNoTickets.length > 0 || !options.hideEmptyBlocks) { -%>
Other Commits
---------------------
<% blockNoTickets.forEach(commit => { -%>
 * <%= commit.authorName %> - <<%= commit.revision.substr(0, 7) %>> - <%= commit.summary %>
<% }); -%>
<% if (!blockNoTickets.length) {%> ~ None ~ <% } %>

<% } -%>
<% blockPendingByOwner = tickets.pendingByOwner; -%>
<% if (blockPendingByOwner.length > 0 || !options.hideEmptyBlocks) { -%>
Pending Approval
---------------------
<% blockPendingByOwner.forEach(owner => { -%>
<%= owner.email %>
<% owner.tickets.forEach((ticket) => { -%>
 * <%= jira.baseUrl + '/browse/' + ticket.key %>
<% }); -%>
<% }); -%>
<% if (!blockPendingByOwner.length) {%> ~ None. Yay! ~ <% } -%>

<% } -%>
<% if (tickets.reverted.length) { %>
Reverted
---------------------
<% tickets.reverted.forEach((ticket) => { -%>
 * <<%= ticket.fields.issuetype.name %>> - <%- ticket.fields.summary %>
   [<%= ticket.key %>] <%= jira.baseUrl + '/browse/' + ticket.key %>
   commit: <%= ticket.reverted %>
<% }); -%>
<% } -%>
`
}

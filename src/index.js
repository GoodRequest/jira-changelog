// Jira Changelog API
module.exports = {
	SourceControl: require('./SourceControl').default,
	Jira: require('./Jira').default,
	Slack: require('./Slack').default,
	Config: require('./Config'),
	template: require('./template')
}

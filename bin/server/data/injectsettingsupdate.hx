var oldSettings = Est.oldSettings;
var isFirstUpdate = oldSettings == null;
var settings = Est.settings;
var playerInfo = Est.playerInfo;
Est.oldSettings = settings;

function isChanged(name) {
	if(isFirstUpdate) {
		return true;
	}
	return settings[name] != oldSettings[name];
}

if(isChanged("fakemoderator")) {
	Gs.moderator = playerInfo.moderator || settings.fakemoderator;
}
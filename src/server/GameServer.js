//  Module:     GameServer
//  Project:    sq-toolbox
//  Author:     soviet
//  E-mail:     soviet@yandex.ru
//  Web:        https://vk.com/sovietxd

const package = require('../shared/Package.js')

const fs = require('fs')

const DEFAULT_SETTINGS = {
	gameinject: true, // внедрять код в клиент
	chatcommands: true, // чат-команды
	ignorechats: [], // список скрытых чатов
	ignorechatshistory: [], // список скрытых историй чатов
	ignoretimersupdates: [], // список скрытых обновлений таймеров
	fakemoderator: true, // визуальный модератор
	fakelevel: -1, // визуальный уровень (-1 — откл)
	removemoderators: true, // показывать модераторов как игроков
	ignoreselfreports: true, // игнорировать жалобы на себя
	ignoreinvalidcreate: true, // игнорировать неверное создание объектов
	ignoreinvaliddestroy: true, // игнорировать неверное удаление объектов
	notifyroom: true, // уведомлять о комнате
	notifyreports: true, // уведомлять о жалобах
	notifyobjects: true, // уведомлять об объектах
	logroom: true, // логировать комнату
	logreports: true, // логировать жалобы
	logobjects: true, // логировать объекты
	sanitizechat: true, // удалять HTML-код из чата
	scriptout: false, // вывод через скрипт
	debuground: false // отладка раунда
}

const MAP_SCRIPT_AS = fs.readFileSync('data/mapscript.as', 'utf8')
const SCRIPT_AS = fs.readFileSync('data/script.as', 'utf8')

const {
	Logger,
	GameServer,
	GameClient,
	ClientData
} = require('sq-lib')

const {
	PacketClient, PacketServer,
	ConfigData, ChatCommon,
	EducationQuestManager
} = ClientData

let clients = []

function showMessage(client, message) {
	if(client.settings.scriptout && client.storage.gameinjected)
		return runScript(client, true, 'showMessage("sq-toolbox", "' + message.replace(/"/g, '\\"').replace(/\n/gm, "\\n") + '")')
	client.sendPacket('PacketAdminMessage', {
		message: message
	})
}

function runMapScript(client, isHaxe, script) {
	client.sendPacket('PacketRoundCommand', {playerId: client.uid, dataJson: {"Create": [73, [["", script, true, 1, 1, 0, false, true, [0, 0], isHaxe]], true]}})
}

function runScript(client, isHaxe, script, ignoreInject = false) {
	if(!ignoreInject && !client.storage.gameinjected) {
		return showMessage(client, 'ВНИМАНИЕ! Неполная активация.\n'
			+ '\n'
			+ 'Для полной активации выйдите на локацию.')
	}
	client.sendPacket('PacketRoundCommand', {playerId: client.uid, dataJson: {"est_runscript": [isHaxe, script]}})
}

function expToLevel(exp) {
	let levels = ConfigData.player.levels
	for(let level in levels)
		if(exp < levels[level].experience)
			return level - 1
	return levels.length - 1
}

function levelToExp(level) {
	let levels = ConfigData.player.levels
	return levels[level in levels ? level : ConfigData.player.MAX_LEVEL].experience
}

function getPlayerInfo(client, id) {
	if(id === client.uid)
		return client.player
	return client.storage.players[id]
}

function getPlayerMention(client, id) {
	let player = getPlayerInfo(client, id)
	if(!player)
		return 'ID ' + id
	return (player.name || 'Без имени') + ' (ID ' + id + ')'
}

function isValidCreate(create) {
	let entityId = create[0]
	if(typeof entityId !== 'number' || entityId % 1 !== 0)
		return false
	let data = create[1]
	let isOldStyle = Array.isArray(data[0]) && data[0].length === 2
	if(isOldStyle) {
		if(typeof data[0][0] !== 'number' || typeof data[0][1] !== 'number')
			return false
		if(typeof data[1] !== 'number')
			return false
		if(typeof data[2] !== 'boolean')
			return false
		return true
	}
	if(!Array.isArray(data[0]))
		return false
	if(!Array.isArray(data[0][0]))
		return false
	if(typeof data[0][0][0] !== 'number' || typeof data[0][0][1] !== 'number')
		return false
	if(typeof data[0][1] !== 'number')
		return false
	if(typeof data[0][2] !== 'boolean')
		return false
	if(typeof data[0][3] !== 'boolean')
		return false
	if(typeof data[0][4] !== 'boolean')
		return false
	if(data[0].length < 6)
		return true
	if(!Array.isArray(data[0][5]))
		return false
	if(typeof data[0][5][0] !== 'number' || typeof data[0][5][1] !== 'number')
		return false
	if(typeof data[0][6] !== 'number')
		return false
	if(typeof data[0][7] !== 'string')
		return false
	if(data[0].length < 9)
		return true
	if(typeof data[0][8] !== 'number')
		return false
	if(data[0].length < 10)
		return true
	if(typeof data[0][9] !== 'boolean')
		return false
	return true
}

function isValidDestroy(destroy) {
	let id = destroy[0]
	if(typeof id !== 'number' || id % 1 !== 0)
		return false
	if(typeof destroy[1] !== 'boolean')
		return false
	return true
}

function handlePlayerInit(client) {
	Logger.info('server', `Вы вошли в игру как ${getPlayerMention(client, client.uid)}`)
	showMessage(client, `sq-toolbox [v${package.version}]\n`
	+ '\n'
	+ 'Для полной активации выйдите на локацию.')
}

function handleLoginServerPacket(client, packet, buffer) {
	client.uid = packet.data.innerId
}

function handleNonSelfInfoServerPacket(client, mask, player) {
	client.storage.players[player.uid] = Object.assign(client.storage.players[player.uid] || {}, player)
	if(player.moderator && client.settings.removemoderators) {
		player.name = player.name + ' [М]'
		player.moderator = 0
	}
}

function handleSelfInfoServerPacket(client, mask, player) {
	if(!client.player && mask === -1) {
		client.player = Object.assign({}, player)
		handlePlayerInit(client)
	}
	if('moderator' in player && client.settings.fakemoderator)
		player.moderator = 1
	if('exp' in player && client.settings.fakelevel !== -1)
		player.exp = levelToExp(client.settings.fakelevel)
}

function handleInfoServerPacket(client, packet, buffer) {
	let { mask, data } = packet.data
	for(let i in data) {
		if(client.uid !== data[i].uid) {
			if(handleNonSelfInfoServerPacket(client, mask, data[i]))
				data.splice(i, 1)
			continue
		}
		if(handleSelfInfoServerPacket(client, mask, data[i]))
			data.splice(i, 1)
	}
}

function handleChatHistoryServerPacket(client, packet, buffer) {
	let { chatType, messages } = packet.data
	if(client.settings.ignorechatshistory.indexOf(chatType) !== -1)
		return true
	for(let i in messages) {
		let { playerId, message } = messages[i]
		if(client.settings.sanitizechat)
			messages[i].message = message.replace(/</g, '&lt;')
	}
}

function handleChatMessageServerPacket(client, packet, buffer) {
	let { chatType, playerId, message } = packet.data
	if(client.settings.ignorechats.indexOf(chatType) !== -1)
		return true
	if(client.settings.sanitizechat)
		packet.data.message = message.replace(/</g, '&lt;')
}

function handleExperienceServerPacket(client, packet, buffer) {
	if(client.settings.fakeLevel !== -1)
		packet.exp = levelToExp(client.settings.fakelevel)
}

function handleBalanceServerPacket(client, packet, buffer) {
	return client.settings.ignoretimersupdates.indexOf('balance') !== -1
}

function handleEnergyServerPacket(client, packet, buffer) {
	return client.settings.ignoretimersupdates.indexOf('energy') !== -1
}

function handleManaServerPacket(client, packet, buffer) {
	return client.settings.ignoretimersupdates.indexOf('mana') !== -1
}

function handleDailyQuestsServerPacket(client, packet, buffer) {
	return client.settings.ignoretimersupdates.indexOf('dailyquests') !== -1
}

function handleRoomRoundServerPacket(client, packet, buffer) {
	switch(packet.data.type) {
		case PacketServer.ROUND_WAITING:
		case PacketServer.ROUND_STARTING:
		case PacketServer.ROUND_RESULTS:
			client.storage.inround = false
			break
		case PacketServer.ROUND_PLAYING:
		case PacketServer.ROUND_START:
		case PacketServer.ROUND_CUT:
			client.storage.inround = true
			if(!client.storage.gameinjected && client.settings.gameinject) {
				client.defer.push(function() {
					runMapScript(client, true, MAP_SCRIPT_AS)
					runScript(client, true, SCRIPT_AS, true)
				})
			}
			client.storage.newobjects = {}
	}
	if(client.storage.onloadroom) {
		client.storage.onloadroom()
		delete client.storage.onloadroom
	}
}

function handleRoomServerPacket(client, packet, buffer) {
	let { locationId, subLocation, players, isPrivate } = packet.data
	client.storage.inroom = true
	if(client.settings.logroom) {
		let mentions = []
		for(let player of players) {
			mentions.push(getPlayerMention(client, player))
		}
		if(mentions.length === 0)
			Logger.info('server', 'В комнате пусто')
		else
			Logger.info('server', 'В комнате: ' + mentions.join(', '))
	}
	if(client.settings.notifyroom) {
		client.storage.onloadroom = function() {
			if(players.length > 0) {
				for(let player of players) {
					client.sendPacket('PacketChatMessage', {
						chatType: 0,
						playerId: player,
						message: '<span class=\'color3\'>Уже в комнате</span>'
					})
				}
			} else {
				client.sendPacket('PacketChatMessage', {
					chatType: 0,
					playerId: client.uid,
					message: '<span class=\'color1\'>В комнате пусто</span>'
				})
			}
		}
	}
}

function handleRoomJoinServerPacket(client, packet, buffer) {
	let { playerId } = packet.data
	if(playerId === client.uid) {
		client.storage.inroom = true 
	} else {
		if(client.settings.logroom) {
			Logger.info('server', `${getPlayerMention(client, playerId)} вошел в комнату`)
		}
		if(client.settings.notifyroom) {
			client.sendPacket('PacketChatMessage', {
				chatType: 0,
				playerId: playerId,
				message: '<span class=\'name_moderator\'>Вошел в комнату</span>'
			})
		}
	}
}

function handleRoomLeaveServerPacket(client, packet, buffer) {
	let { playerId } = packet.data
	if(playerId === client.uid) {
		client.storage.inroom = false
	} else {
		if(client.settings.logroom) {
			Logger.info('server', `${getPlayerMention(client, playerId)} вышел из комнаты`)
		}
		if(client.settings.notifyroom) {
			client.sendPacket('PacketChatMessage', {
				chatType: 0,
				playerId: playerId,
				message: '<span class=\'color1\'>Вышел из комнаты</span>'
			})
		}
	}
}

function handleRoundCommandServerPacket(client, packet, buffer) {
	let { playerId, dataJson } = packet.data
	if(!dataJson)
		return
	if('reportedPlayerId' in dataJson) {
		if(client.settings.logreports) {
			Logger.info('server', `${getPlayerMention(client, playerId)} кинул жалобу на ${getPlayerMention(client, dataJson.reportedPlayerId)}`)
		}
		if(client.settings.notifyreports) {
			client.sendPacket('PacketChatMessage', {
				chatType: 0,
				playerId: playerId,
				message: `<span class=\'color3\'>Кинул жалобу на</span> <span class=\'color1\'>${getPlayerMention(client, dataJson.reportedPlayerId)}</span>`
			})
		}
		if(dataJson.reportedPlayerId === client.uid && client.settings.ignoreselfreports)
			return true
	}
	if('Create' in dataJson) {
		if(client.settings.ignoreinvalidcreate && !isValidCreate(dataJson.Create)) {
			if(client.settings.logobjects) {
				Logger.info('server', `${getPlayerMention(client, playerId)} пытался создать объект Entity ${dataJson.Create[0].toString()}`)
			}
			if(client.settings.notifyobjects) {
				client.sendPacket('PacketChatMessage', {
					chatType: 0,
					playerId: playerId,
					message: `<span class=\'color3\'>Пытался создать объект</span> <span class=\'color1\'>Entity ${dataJson.Create[0].toString()}</span>`
				})
			}
			return true
		} else {
			if(!client.storage.newobjects[playerId])
				client.storage.newobjects[playerId] = 1
			else
				client.storage.newobjects[playerId]++
		}
	}
	if('Destroy' in dataJson) {
		if(client.settings.ignoreinvaliddestroy) {
			if(!isValidDestroy(dataJson.Destroy) || !client.storage.newobjects[playerId]) {
				if(client.settings.logobjects) {
					Logger.info('server', `${getPlayerMention(client, playerId)} пытался удалить объект ID ${dataJson.Destroy[0].toString()}`)
				}
				if(client.settings.notifyobjects) {
					client.sendPacket('PacketChatMessage', {
						chatType: 0,
						playerId: playerId,
						message: `<span class=\'color3\'>Пытался удалить объект</span> <span class=\'color1\'>ID ${dataJson.Destroy[0].toString()}</span>`
					})
				}
				return true
			}
			client.storage.newobjects[playerId]--
		}
	}
}

function handleServerPacket(client, packet, buffer) {
	Logger.debug('server', 'Server packet', packet)
	if(client.settings.debuground) {
		if(packet.type.startsWith('PacketRoom') || packet.type.startsWith('PacketRound'))
			Logger.info('server', packet.type, packet.data)
	}
	switch(packet.type) {
		case 'PacketLogin':
			if(handleLoginServerPacket(client, packet, buffer))
				return
			break
		case 'PacketInfo':
			if(handleInfoServerPacket(client, packet, buffer))
				return
			break
		case 'PacketChatHistory':
			if(handleChatHistoryServerPacket(client, packet, buffer))
				return
			break
		case 'PacketChatMessage':
			if(handleChatMessageServerPacket(client, packet, buffer))
				return
			break
		case 'PacketExperience':
			if(handleExperienceServerPacket(client, packet, buffer))
				return
			break
		case 'PacketBalance':
			if(handleBalanceServerPacket(client, packet, buffer))
				return
			break
		case 'PacketEnergy':
			if(handleEnergyServerPacket(client, packet, buffer))
				return
		case 'PacketMana':
			if(handleManaServerPacket(client, packet, buffer))
				return
		case 'PacketDailyQuests':
			if(handleDailyQuestsServerPacket(client, packet, buffer))
				return
			break
		case 'PacketRoom':
			if(handleRoomServerPacket(client, packet, buffer))
				return
			break
		case 'PacketRoomRound':
			if(handleRoomRoundServerPacket(client, packet, buffer))
				return
			break
		case 'PacketRoomJoin':
			if(handleRoomJoinServerPacket(client, packet, buffer))
				return
			break
		case 'PacketRoomLeave':
			if(handleRoomLeaveServerPacket(client, packet, buffer))
				return
			break
		case 'PacketRoundCommand':
			if(handleRoundCommandServerPacket(client, packet, buffer))
				return
	}
	client.sendData(packet)
	while(client.defer.length > 0) {
		client.defer.shift()()
	}
}

function handleHelloClientPacket(client, packet, buffer) {
	client.storage = { players: {} }
	client.defer = []
	client.settings = DEFAULT_SETTINGS
}

function handleLoginClientPacket(client, packet, buffer) {
	client.storage.logindata = buffer.toString('base64')
}

function handleRoundSkillClientPacket(client, packet, buffer) {
	let [code, activate, unk0, unk1] = packet.data
	if(client.storage.cancelnextskill && activate) {
		delete client.storage.cancelnextskill
		client.proxy.sendPacket('ROUND_SKILL', code, true, unk0, unk1)
		client.proxy.sendPacket('ROUND_SKILL', code, false, unk0, unk1)
		return true
	}
}

function handleRoundCommandClientPacket(client, packet, buffer) {
	let [data] = packet.data
	if(client.settings.gameinject) {
		if(!client.storage.gameinjected) {
			if('ScriptedTimer' in data) {
				client.sendPacket('PacketRoundCommand', {playerId: client.uid, dataJson: {'ScriptedTimer': data['ScriptedTimer']}})
				return true
			}
		}
		if('est_callback' in data) {
			switch(data['est_callback'][0]) {
				case 'injected':
					if(client.storage.gameinjected)
						break
					client.storage.gameinjected = true
					showMessage(client, 'Успешная полная активация.')
			}
			return true
		}
	}
}

function handleHelpCommand(client, chatType, args) {
	showMessage(client, 'Доступные команды:\n'
		+ '\n'
		+ '.settings help — настройки\n'
		+ '.player help — команды игрока\n'
		+ '.clan help — команды клана\n'
		+ '.hack help — команды хаков\n'
		+ '.debug help — команды отладки')
}

function handleSettingsCommand(client, chatType, args) {
	if(args[0] === undefined || args[0] === 'help') {
		return showMessage(client, 'Помощь:\n'
			+ '\n'
			+ 'Изменить настройки программы:\n'
			+ '.settings [настройка] [значение]\n'
			+ '\n'
			+ 'Доступные настройки:\n'
			+ Object.keys(DEFAULT_SETTINGS).join(', '))
	}
	let name = args.shift()
	let value = args.join(' ')
	if(!(name in client.settings))
		return showMessage(client, 'Неизвестная настройка.')
	switch(typeof(client.settings[name])) {
		case 'string':
			client.settings[name] = args
			break
		case 'number':
			if(value.indexOf('.') != -1)
				client.settings[name] = parseFloat(args)
			else
				client.settings[name] = parseInt(args, 10)
			break
		case 'boolean':
			if(value === 'true' || value === 'on' || value === '1')
				client.settings[name] = true
			else
				client.settings[name] = false
			return showMessage(client, `Настройка ${name} установлена в значение ${client.settings[name] ? '1' : '0'}.`)
		case 'object':
			client.settings[name] = JSON.parse(args)
	}
	return showMessage(client, `Настройка ${name} установлена в значение ${args}.`)
}

function handlePlayerSearchCommand(client, chatType, args) {
	let playerId = parseInt(args[0], 10)
	if(isNaN(playerId))
		return showMessage(client, 'Неправильный синтаксис.')
	client.sendPacket('PacketChatMessage', {
		chatType: chatType,
		playerId: playerId,
		message: '<span class=\'color3\'>Я читерил меня искали.</span>'
	})
}

function handlePlayerCommand(client, chatType, args) {
	let cmd = args.shift()
	switch(cmd) {
		case 'help':
		case undefined:
			showMessage(client, 'Подкоманды:\n'
				+ '\n'
				+ '.player search [id] — поиск игрока по ID')
			break
		case 'search':
			handlePlayerSearchCommand(client, chatType, args)
			break
		default:
			showMessage(client, 'Неизвестная подкоманда.')
	}
}

function handleClanDonateCommand(client, chatType, args) {
	let coins = parseInt(args[0], 10)
	let nuts = parseInt(args[1], 10)
	if(isNaN(coins) || isNaN(nuts))
		return showMessage(client, 'Неправильный синтаксис.')
	client.proxy.sendPacket('CLAN_DONATION', coins, nuts)
	showMessage(client, `В клан внесено ${coins} монет ${nuts} орехов.`)
}

function handleClanCommand(client, chatType, args) {
	let cmd = args.shift()
	switch(cmd) {
		case 'help':
		case undefined:
			showMessage(client, 'Подкоманды:\n'
				+ '\n'
				+ '.clan donate [монеты] [орехи] — внести в клан монеты/орехи')
			break
		case 'donate':
			handleClanDonateCommand(client, chatType, args)
			break
		default:
			showMessage(client, 'Неизвестная подкоманда.')
	}
}

function handleHackOlympicCommand(client, chatType, args) {
	client.proxy.sendPacket('PLAY', 15, 0)
}

function handleHackSkillCommand(client, chatType, args) {
	client.storage.cancelnextskill = true
	showMessage(client, 'Следующая способность будет багнута отменой.')
}

function handleHackCrashCommand(client, chatType, args) {
	client.proxy.sendPacket('ROUND_COMMAND', {"Create": [1, [[[]]], true]})
}

function handleHackLevelCommand(client, chatType, args) {
	client.storage.doquestsuntil = true
	showMessage(client, 'Уровни в процессе выдачи..')
}

function handleHackCommand(client, chatType, args) {
	let cmd = args.shift()
	switch(cmd) {
		case 'help':
		case undefined:
			showMessage(client, 'Подкоманды:\n'
				+ '\n'
				+ '.hack olympic — локация "Стадион"\n'
				+ '.hack skill — баг отмены способности\n'
				+ '.hack crash — баг вылета объектом')
			break
		case 'olympic':
			handleBugOlympicCommand(client, chatType, args)
			break
		case 'skill':
			handleBugSkillCommand(client, chatType, args)
			break
		case 'crash':
			handleHackCrashCommand(client, chatType, args)
			break
		default:
			showMessage(client, 'Неизвестная подкоманда.')
	}
}

function handleDebugDumpPlayerCommand(client, chatType, args) {
	showMessage(client, 'Дамп данных игрока:\n'
		+ '\n'
		+ Buffer.from(JSON.stringify(client.player)).toString('base64'))
}

function handleDebugDumpLoginCommand(client, chatType, args) {
	showMessage(client, 'ВНИМАНИЕ!!! НИКОМУ НЕ ПЕРЕДАВАЙТЕ ЭТИ ДАННЫЕ!!!\n'
		+ '\n'
		+ 'Дамп данных входа:\n'
		+ '\n'
		+ client.storage.logindata)
}

function handleDebugDumpCommand(client, chatType, args) {
	let cmd = args.shift()
	switch(cmd) {
		case 'help':
		case undefined:
			showMessage(client, 'Подкоманды:\n'
				+ '\n'
				+ '.debug dump player — данные профиля\n'
				+ '.debug dump login — данные входа')
			break
		case 'player':
			handleDebugDumpPlayerCommand(client, chatType, args)
			break
		case 'login':
			handleDebugDumpLoginCommand(client, chatType, args)
			break
		default:
			showMessage(client, 'Неизвестная подкоманда.')
	}
}

function handleDebugRunCommand(client, chatType, args) {
	let file = 'scripts/' + args.shift()
	let isHaxe = !file.endsWith('.lua')
	if(!fs.existsSync(file))
		return showMessage(client, 'Скрипт не найден.')
	let script = fs.readFileSync(file, 'utf8')
	runScript(client, isHaxe, script)
}

function handleDebugCommand(client, chatType, args) {
	let cmd = args.shift()
	switch(cmd) {
		case 'help':
		case undefined:
			showMessage(client, 'Доступные подкоманды:\n'
				+ '\n'
				+ '.debug dump help — данные отладки\n'
				+ '.debug run [имя] — запустить скрипт')
			break
		case 'dump':
			handleDebugDumpCommand(client, chatType, args)
			break
		case 'run':
			handleDebugRunCommand(client, chatType, args)
			break
		case 'inject':
			runMapScript(client, true, fs.readFileSync('data/mapscript.as', 'utf8'))
			break
		default:
			showMessage(client, 'Неизвестная подкоманда.')
	}
}

function handleChatMessageClientPacket(client, packet, buffer) {
	let [chatType, msg] = packet.data
	if(!msg.startsWith('.'))
		return
	if(msg === '.')
		return
	if(!client.settings.chatcommands)
		return
	let args = msg.substring(1).split(' ')
	let cmd = args.shift()
	switch(cmd) {
		case 'help':
			handleHelpCommand(client, chatType, args)
			break
		case 'settings':
			handleSettingsCommand(client, chatType, args)
			break
		case 'player':
			handlePlayerCommand(client, chatType, args)
			break
		case 'clan':
			handleClanCommand(client, chatType, args)
			break
		case 'hack':
			handleHackCommand(client, chatType, args)
			break
		case 'debug':
			handleDebugCommand(client, chatType, args)
			break
		default:
			showMessage(client, 'Неизвестная команда.')
	}
	return true
}

function handleClientPacket(client, packet, buffer) {
	Logger.debug('server', 'Client packet', packet)
	switch(packet.type) {
		case 'HELLO':
			handleHelloClientPacket(client, packet, buffer)
			break
		case 'LOGIN':
			if(handleLoginClientPacket(client, packet, buffer))
				return
			break
		case 'ROUND_SKILL':
			if(handleRoundSkillClientPacket(client, packet, buffer))
				return
			break
		case 'ROUND_COMMAND':
			if(handleRoundCommandClientPacket(client, packet, buffer))
				return
			break
		case 'CHAT_MESSAGE':
			if(handleChatMessageClientPacket(client, packet, buffer))
				return
	}
	client.proxy.sendData(packet)
}

function createProxy(client, ports, host) {
	let proxy = new GameClient({
		port: ports[Math.floor(Math.random() * ports.length)],
		host: host
	})
	proxy.on('client.connect', () => client.open())
	proxy.on('client.close', () => client.close())
	proxy.on('client.error', () => client.close())
	proxy.on('client.timeout', () => client.close())
	proxy.on('packet.incoming', (...args) => handleServerPacket(client, ...args))
	return proxy
}

function handleConnect(client, ports, host) {
	clients.push(client)
	client.proxy = createProxy(client, ports, host)
	client.proxy.open()
}

function handleClose(client) {
	if(client.uid)
		Logger.info('server', `Вы вышли из игры как ${getPlayerMention(client, client.uid)}`)
	else
		Logger.info('server', 'Вы вышли из игры')
	clients = clients.filter((e) => e != client)
	if(!client.proxy)
		return
	client.proxy.removeAllListeners()
	client.proxy.close()
}

module.exports = function(options) {
	const gameServer = new GameServer({
		port: JSON.parse(options.server.ports),
		host: '127.0.0.1',
		manualOpen: true
	})
	gameServer.on('client.connect', (client) => handleConnect(client, JSON.parse(options.server.remoteports), options.server.remotehost))
	gameServer.on('client.close', handleClose)
	gameServer.on('client.error', handleClose)
	gameServer.on('client.timeout', handleClose)
	gameServer.on('packet.incoming', handleClientPacket)
	return gameServer
}
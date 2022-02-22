// Haivision KB Encoder

var instance_skel = require('../../instance_skel')

function instance(system, id, config) {
	let self = this

	// super-constructor
	instance_skel.apply(this, arguments)

	self.actions()

	return self
}

instance.prototype.sessionId = null
instance.prototype.deviceId = null
instance.prototype.polling = null

instance.prototype.channels = []
instance.prototype.channels_list = [{ id: 'null', label: '(no channels found)' }]

instance.prototype.Variables = [
	{
		label: 'Current Software Version',
		name: 'current_version',
	},
	{
		label: 'Current CPU Usage',
		name: 'current_cpu_usage',
	},
	{
		label: 'Current Memory Usage',
		name: 'current_mem_usage',
	},
	{
		label: 'Free Disk Space (GB)',
		name: 'free_disk_space',
	},
	{
		label: 'Total Disk Space (GB)',
		name: 'total_disk_space',
	},
	{
		label: 'Used Disk Space (Percent)',
		name: 'used_disk_space',
	},
	{
		label: 'Device Name',
		name: 'device_name',
	},
	{
		label: 'Uptime (Hours)',
		name: 'uptime',
	},
	{
		label: 'Network Incoming',
		name: 'network_incoming',
	},
	{
		label: 'Network Outgoing',
		name: 'network_outgoing',
	},
]

/**
 * Config updated by the user.
 */
instance.prototype.updateConfig = function (config) {
	let self = this
	self.config = config
	clearInterval(self.polling)
	clearInterval(self.polling_login)

	self.init_login()
}

/**
 * Initializes the module.
 */
instance.prototype.init = function () {
	let self = this

	self.request = require('request')

	self.init_variables()
	self.init_feedbacks()
	self.init_login()
}

instance.prototype.init_variables = function () {
	let self = this

	self.setVariableDefinitions(self.Variables)
}

instance.prototype.init_feedbacks = function () {
	let self = this

	// feedbacks
	let feedbacks = {}

	feedbacks['state'] = {
		label: 'Change Button Color If Channel is in Running State',
		description: 'If selected channel is in running state, set the button to this color.',
		options: [
			{
				type: 'dropdown',
				label: 'Channel',
				id: 'channel',
				choices: self.channels_list,
			},
			{
				type: 'colorpicker',
				label: 'Foreground Color',
				id: 'fg',
				default: self.rgb(0, 0, 0),
			},
			{
				type: 'colorpicker',
				label: 'Background Color',
				id: 'bg',
				default: self.rgb(0, 255, 0),
			},
		],
	}

	self.setFeedbackDefinitions(feedbacks)
}

instance.prototype.feedback = function (feedback, bank) {
	let self = this

	if (feedback.type === 'state') {
		for (let i = 0; i < self.channels.length; i++) {
			if (self.channels[i].id === feedback.options.channel) {
				if (self.channels[i].state === 'running') {
					return { color: feedback.options.fg, bgcolor: feedback.options.bg }
				}
			}
		}
	}

	return {}
}

instance.prototype.init_login = function () {
	let self = this

	if (self.config.username && self.config.password) {
		if (self.config.username !== '' && self.config.password !== '') {
			//username and password not blank, so initiate login session
			let body = {
				username: self.config.username,
				password: self.config.password,
			}

			let cmd = '/api/session'
			let url = self.makeUrl(cmd)
			self.request.post({ url: url, json: body, rejectUnauthorized: false }, function (error, response, body) {
				// Success
				self.sessionId = null

				try {
					let cookies = response.headers['set-cookie']
					let cookiesString = cookies.toString()
					let cookiesArray = cookiesString.split(';')

					for (let i = 0; i < cookiesArray.length; i++) {
						if (cookiesArray[i].indexOf('sessionID=') > -1) {
							//this is the session id that we want
							let values = cookiesArray[i].split('=')
							self.sessionId = values[1]
							break
						}
					}

					if (self.sessionId !== null) {
						self.status(self.STATUS_OK)
						self.log('info', 'Session authenticated. Session ID: ' + self.sessionId)

						self.get_variables()

						self.polling = setInterval(() => {
							self.get_variables()
						}, 1000) //1 second

						self.polling_login = setTimeout(() => {
							self.log('info', 'Reauthenticating Login Session.')
							self.init_login()
						}, 1200000) //20 minutes
					} else {
						self.status(self.STATUS_ERROR)
						self.log('error', 'Login error: Session ID not returned.')
					}
				} catch (error) {
					self.status(self.STATUS_ERROR)
					self.log('error', 'Login error parsing cookies: ' + error)
				}
			})
		}
	}
}

instance.prototype.getTime = function () {
	var d = new Date()
	var milliseconds = d.getTime()

	return milliseconds
}

instance.prototype.get_variables = function () {
	let self = this

	let cmd, url, cookieJarAuth, cookie1

	//Get System Level Information
	cmd = '/api/system?_=' + self.getTime()
	url = self.makeUrl(cmd)
	cookieJarAuth = self.request.jar()
	cookie1 = self.request.cookie('sessionID=' + self.sessionId)
	cookieJarAuth.setCookie(cookie1, url)

	self.request.get({ url: url, jar: cookieJarAuth, rejectUnauthorized: false }, function (error, response, body) {
		try {
			let data = JSON.parse(body)

			if (data.version) {
				self.setVariable('current_version', data.version.release + ' Build ' + data.version.build)
			}

			if (data.uptime) {
				self.setVariable('uptime', `${data.uptime.days}d${data.uptime.hrs}h${data.uptime.mins}m${data.uptime.secs}s`)
			}
		} catch(e) {
			self.debug(e)
		}
	})

	//Get Device Information
	cmd = '/api/devices?_=' + self.getTime()
	url = self.makeUrl(cmd)
	cookieJarAuth = self.request.jar()
	cookie1 = self.request.cookie('sessionID=' + self.sessionId)
	cookieJarAuth.setCookie(cookie1, url)

	self.request.get({ url: url, jar: cookieJarAuth, rejectUnauthorized: false }, function (error, response, body) {
		try {
			let data = JSON.parse(body)

			if (data[0]) {
				self.deviceId = data[0]['_id']
				self.setVariable('device_name', data[0].name)

				self.get_channels(self.deviceId)
				self.get_statistics(self.deviceId)
			}
		} catch (e) {
			self.debug(e)
		}
	})
}

instance.prototype.get_channels = function (deviceId) {
	let self = this

	let cmd, url, cookieJarAuth, cookie1

	cmd = `/api/kulabyte/${deviceId}/channels?_=${self.getTime()}`
	url = self.makeUrl(cmd)
	cookieJarAuth = self.request.jar()
	cookie1 = self.request.cookie('sessionID=' + self.sessionId)
	cookieJarAuth.setCookie(cookie1, url)

	self.request.get({ url: url, jar: cookieJarAuth, rejectUnauthorized: false }, function (error, response, body) {
		try {
			let data = JSON.parse(body)

			let newChannels = false

			for (let i = 0; i < data.length; i++) {
				if (data[i]) {
					const found = self.channels_list.some((el) => el.id === data[i]['_id'])
					if (!found) {
						let channelObj = {}
						channelObj.id = data[i]['_id']
						channelObj.name = data[i].name
						channelObj.recordingArmed = data[i].recording === 'active' ? true : false
						channelObj.state = data[i].state
						self.channels.push(channelObj)

						let channelListObj = {}
						channelListObj.id = data[i]['_id']
						channelListObj.label = unescape(data[i].name)
						self.channels_list.push(channelListObj)

						newChannels = true //set the bool to true so we can later update actions/feedbacks list
					} else {
						//update the channel state
						let index = self.channels.findIndex((obj) => obj.id == data[i]['_id'])

						self.channels[index].name = data[i].name
						self.channels[index].recordingArmed = data[i].recording === 'active' ? true : false
						self.channels[index].state = data[i].state
					}

					let foundStateVariable = false
					let channel_name = unescape(data[i]['_name']).replace(' ', '_')

					for (let i = 0; i < self.Variables.length; i++) {
						if (self.Variables[i].name === 'state_' + channel_name) {
							foundStateVariable = true
						}
					}

					if (!foundStateVariable) {
						let variableObj = {}
						variableObj.name = 'state_' + channel_name
						self.Variables.push(variableObj)
					}

					if (!foundStateVariable) {
						//only set the variable definitions again if we added a new variable, this should cut down on unneccessary requests
						self.setVariableDefinitions(self.Variables)
					}

					self.setVariable('state_' + channel_name, data[i].state)
					self.checkFeedbacks('state')
					
					if (newChannels) {
						self.actions() //republish list of actions because of new channel data
						self.init_feedbacks() //republish list of feedbacks because of new channel data
					}
				}
			}

			if (newChannels) {
				self.actions() //republish list of actions because of new channel data
				self.init_feedbacks() //republish list of feedbacks because of new channel data
			}
		} catch(e) {
			self.debug(e)
		}
	})
}

instance.prototype.get_statistics = function (deviceId) {
	let self = this

	let cmd, url, cookieJarAuth, cookie1

	cmd = `/api/kulabyte/${deviceId}/encoder/statistics?_=${self.getTime()}`
	url = self.makeUrl(cmd)
	cookieJarAuth = self.request.jar()
	cookie1 = self.request.cookie('sessionID=' + self.sessionId)
	cookieJarAuth.setCookie(cookie1, url)

	self.request.get({ url: url, jar: cookieJarAuth, rejectUnauthorized: false }, function (error, response, body) {
		try {
			let data = JSON.parse(body)

			self.setVariable('current_cpu_usage', data.cpu)
			self.setVariable('current_mem_usage', data.memory)
			
			if (data.diskSpace) {
				self.setVariable('free_disk_space', data.diskSpace.free)
				self.setVariable('total_disk_space', data.diskSpace.total)
				self.setVariable('used_disk_space', data.diskSpace.usedPercent)
			}

			if (data.network) {
				self.setVariable('network_incoming', data.network.incoming)
				self.setVariable('network_outgoing', data.network.outgoing)
			}
		} catch(e) {
			self.debug(e)
		}
	})
}

instance.prototype.control_channel = function (channelId, command) {
	let self = this

	let cmd, url, cookieJarAuth, cookie1

	cmd = `/api/kulabyte/${self.deviceId}/channels/${channelId}/${command}`
	url = self.makeUrl(cmd)
	cookieJarAuth = self.request.jar()
	cookie1 = self.request.cookie('sessionID=' + self.sessionId)
	cookieJarAuth.setCookie(cookie1, url)

	self.request.post({ url: url, jar: cookieJarAuth, rejectUnauthorized: false }, function (error, response, body) {
		//let data = JSON.parse(body)
	})
}

/**
 * Return config fields for web config.
 */
instance.prototype.config_fields = function () {
	let self = this

	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This module will control a Haivision KB Encoder using the web API.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'IP Address',
			width: 4,
			regex: self.REGEX_IP,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 4,
			default: '',
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'Password',
			width: 4,
			default: '',
		},
	]
}

/**
 * Cleanup when the module gets deleted.
 */
instance.prototype.destroy = function () {
	let self = this
	clearInterval(self.polling)
	clearInterval(self.polling_login)
	self.debug('destroy')
}

/**
 * Populates the supported actions.
 */
instance.prototype.actions = function (system) {
	let self = this

	self.setActions({
		start_channel: {
			label: 'Start a Channel',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list,
				},
			],
		},
		stop_channel: {
			label: 'Stop a Channel',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list,
				},
			],
		},
		start_channel_all: {
			label: 'Start All Channels',
		},
		stop_channel_all: {
			label: 'Stop All Channels',
		},
		arm_recording: {
			label: 'Arm Recording',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list,
				},
			],
		},
		disarm_recording: {
			label: 'Disarm Recording',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list,
				},
			],
		},
	})
}

/**
 * Runs the specified action.
 *
 * @param action
 */
instance.prototype.action = function (action) {
	let self = this
	let opt = action.options

	try {
		switch (action.action) {
			case 'start_channel':
				self.control_channel(opt.channel, 'start')
				break
			case 'stop_channel':
				self.control_channel(opt.channel, 'stop')
				break
			case 'start_channel_all':
				for (let i = 0; i < self.channels_list.length; i++) {
					self.control_channel(self.channels_list[i].id, 'start')
				}
				break
			case 'stop_channel_all':
				for (let i = 0; i < self.channels_list.length; i++) {
					self.control_channel(self.channels_list[i].id, 'stop')
				}
				break
			case 'arm_recording':
				self.control_channel(opt.channel, 'recording/start')
				break
			case 'disarm_recording':
				self.control_channel(opt.channel, 'recording/stop')
				break
		}
	} catch (err) {
		self.log('error', 'Error Executing Action: ' + err.message)
	}
}

/**
 * Makes the complete URL.
 *
 * @param cmd           Must start with a /
 */
instance.prototype.makeUrl = function (cmd) {
	let self = this

	if (cmd[0] !== '/') {
		throw new Error('cmd must start with a /')
	}

	return 'https://' + self.config.host + cmd
}

instance_skel.extendedBy(instance)
exports = module.exports = instance

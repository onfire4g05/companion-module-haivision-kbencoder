// Haivision KB Encoder

const instance_skel = require('../../instance_skel')
const upgrades = require('./upgrades')

const request = require('request').defaults({
	rejectUnauthorized: false,
});

class instance extends instance_skel {
	constructor(system, id, config) {
		super(system, id, config)
		this.defineConst('POLLING_INTERVAL', 1000)
		this.defineConst('REAUTH_TIME', 1200000)
		this.defineConst('RUN_STATES', [
			{ id: 'start_pending', label: 'Starting' },
			{ id: 'running', label: 'Running' },
			{ id: 'idle', label: 'Idle' },
			{ id: 'pre_stop_pending', label: 'Preparing to Stop' },
			{ id: 'pre_stop', label: 'Stopping' },
			{ id: 'stopped', label: 'Stopped' },
		])

		this.actions()
	}

	static GetUpgradeScripts() {
		return [
			instance_skel.CreateConvertToBooleanFeedbackUpgradeScript({
				'state': {
					'bg': 'bgcolor',
					'fg': 'color'
				}
			}),
			upgrades.addStateRunning,
		]
	}

	init() {
		this.sessionId = null
		this.deviceId = null
		this.polling = null
		this.channels = []
		this.channels_list = [{ id: 'null', label: '(no channels found)' }]
		this.variables = [
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

		this.init_variables()
		this.init_feedbacks()
		this.init_login()
	}

	init_variables() {
		this.setVariableDefinitions(this.variables)
	}

	updateConfig(config) {
		this.config = config
		this.disconnect()
		this.init()
	}

	init_feedbacks() {
		const feedbacks = {
			state: {
				type: 'boolean',
				label: 'Change Button Color If Channel is in Running State',
				description: 'If selected channel is in running state, set the button to this color.',
				style: {
					color: this.rgb(255,255,255),
					bgcolor: this.rgb(51, 102, 0)
				},
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.channels_list
					},
					{
						type: 'dropdown',
						label: 'State',
						id: 'state',
						choices: this.RUN_STATES
					}
				],
				callback: (feedback) => {
					return this.channels.some(channel => {
						if (channel.id !== feedback.options.channel) return false
						if (feedback.options.state === channel.state) return true

						return false
					})
				}
			}
		}

		this.setFeedbackDefinitions(feedbacks)
	}

	init_login() {
		if (this.config.username && this.config.password) {
			if (this.config.username !== '' && this.config.password !== '') {
				//username and password not blank, so initiate login session
				let body = {
					username: this.config.username,
					password: this.config.password,
				}
	
				let cmd = '/api/session'
				let url = this.makeUrl(cmd)
				request.post({ url: url, json: body }, (error, response, body) => {
					// Success
					this.sessionId = null
	
					try {
						let cookies = response.headers['set-cookie']
						let cookiesString = cookies.toString()
						let cookiesArray = cookiesString.split(';')
	
						for (let i = 0; i < cookiesArray.length; i++) {
							if (cookiesArray[i].indexOf('sessionID=') > -1) {
								//this is the session id that we want
								let values = cookiesArray[i].split('=')
								this.sessionId = values[1]
								break
							}
						}
	
						if (this.sessionId !== null) {
							this.status(this.STATUS_OK)
							this.log('info', 'Session authenticated. Session ID: ' + this.sessionId)
	
							this.get_variables()
	
							this.polling = setInterval(() => {
								this.get_variables()
							}, this.POLLING_INTERVAL)
	
							this.polling_login = setTimeout(() => {
								this.log('info', 'Reauthenticating Login Session.')
								this.init_login()
							}, this.REAUTH_TIME)
						} else {
							this.status(this.STATUS_ERROR)
							this.log('error', 'Login error: Session ID not returned.')
						}
					} catch (error) {
						this.status(this.STATUS_ERROR)
						this.log('error', 'Login error parsing cookies: ' + error)
					}
				})
			}
		}
	}
	
	getTime() {
		var d = new Date()
		var milliseconds = d.getTime()
	
		return milliseconds
	}
	
	get_variables() {
		let cmd, url, cookieJarAuth, cookie1
	
		//Get System Level Information
		cmd = '/api/system?_=' + this.getTime()
		url = this.makeUrl(cmd)
		cookieJarAuth = request.jar()
		cookie1 = request.cookie('sessionID=' + this.sessionId)
		cookieJarAuth.setCookie(cookie1, url)
	
		request.get({ url: url, jar: cookieJarAuth }, (error, response, body) => {
			try {
				let data = JSON.parse(body)
	
				if (data.version) {
					this.setVariable('current_version', data.version.release + ' Build ' + data.version.build)
				}
	
				if (data.uptime) {
					this.setVariable('uptime', `${data.uptime.days}d${data.uptime.hrs}h${data.uptime.mins}m${data.uptime.secs}s`)
				}
			} catch(e) {
				this.debug(e)
			}
		})
	
		//Get Device Information
		cmd = '/api/devices?_=' + this.getTime()
		url = this.makeUrl(cmd)
		cookieJarAuth = request.jar()
		cookie1 = request.cookie('sessionID=' + this.sessionId)
		cookieJarAuth.setCookie(cookie1, url)
	
		request.get({ url: url, jar: cookieJarAuth }, (error, response, body) => {
			try {
				let data = JSON.parse(body)
	
				if (data[0]) {
					this.deviceId = data[0]['_id']
					this.setVariable('device_name', data[0].name)
	
					this.get_channels(this.deviceId)
					this.get_statistics(this.deviceId)
				}
			} catch (e) {
				this.debug(e)
			}
		})
	}
	
	_channelStateVariableName(channel_name) {
		return 'state_' + unescape(channel_name).replace(' ', '_')
	}

	/**
	 * Adds a channel if its new to the channel list
	 * @param {Object} channel 
	 */
	_addChannel(channel) {
		this.channels.push({
			id: channel._id,
			name: channel.name
		})

		this.variables.push({
			label: `Channel ${channel.name} state`,
			name: this._channelStateVariableName(channel.name)
		})

		this.channels_list.push({
			id: channel._id,
			label: unescape(channel.name)
		})
	}

	_updateChannel(channel) {
		const id = this.channels.findIndex(x => x.id = channel._id)

		this.channels[id].recordingArmed = channel.recording === 'active' ? true : false
		this.channels[id].state = channel.state

		this.setVariable(this._channelStateVariableName(channel.name), channel.state)
	}

	isChannel(channel_id) {
		return this.channels.find(x => x.id === channel_id)
	}

	get_channels(deviceId) {
		let cmd, url, cookieJarAuth, cookie1
	
		cmd = `/api/kulabyte/${deviceId}/channels?_=${this.getTime()}`
		url = this.makeUrl(cmd)
		cookieJarAuth = request.jar()
		cookie1 = request.cookie('sessionID=' + this.sessionId)
		cookieJarAuth.setCookie(cookie1, url)
	
		request.get({ url: url, jar: cookieJarAuth }, (error, response, body) => {
			try {
				let channel_list = JSON.parse(body)
				let new_channels = false

				if (!Array.isArray(channel_list)) {
					this.debug('Invalid data from server... expected an array')
					return
				}

				channel_list.forEach(channel => {
					if (this.channels.length === 0) this.channels_list = [];

					if (!this.isChannel(channel._id)) {
						this._addChannel(channel)
						new_channels = true
					}

					this._updateChannel(channel)
				})

				if (new_channels) {
					this.init_variables(this.variables)
					this.actions()
					this.init_feedbacks()
				}

				this.checkFeedbacks('state')
			} catch(e) {
				this.debug(e)
			}
		})
	}
	
	get_statistics(deviceId) {
		let cmd, url, cookieJarAuth, cookie1
	
		cmd = `/api/kulabyte/${deviceId}/encoder/statistics?_=${this.getTime()}`
		url = this.makeUrl(cmd)
		cookieJarAuth = request.jar()
		cookie1 = request.cookie('sessionID=' + this.sessionId)
		cookieJarAuth.setCookie(cookie1, url)
	
		request.get({ url: url, jar: cookieJarAuth }, (error, response, body) => {
			try {
				let data = JSON.parse(body)
	
				this.setVariable('current_cpu_usage', data.cpu)
				this.setVariable('current_mem_usage', data.memory)
				
				if (data.diskSpace) {
					this.setVariable('free_disk_space', data.diskSpace.free)
					this.setVariable('total_disk_space', data.diskSpace.total)
					this.setVariable('used_disk_space', data.diskSpace.usedPercent)
				}
	
				if (data.network) {
					this.setVariable('network_incoming', data.network.incoming)
					this.setVariable('network_outgoing', data.network.outgoing)
				}
			} catch(e) {
				this.debug(e)
			}
		})
	}
	
	control_channel(channelId, command) {
		let cmd, url, cookieJarAuth, cookie1
	
		cmd = `/api/kulabyte/${this.deviceId}/channels/${channelId}/${command}`
		url = this.makeUrl(cmd)
		cookieJarAuth = request.jar()
		cookie1 = request.cookie('sessionID=' + this.sessionId)
		cookieJarAuth.setCookie(cookie1, url)
	
		request.post({ url: url, jar: cookieJarAuth }, (error, response, body) => {
			//let data = JSON.parse(body)
		})
	}
	
	/**
	 * Return config fields for web config.
	 */
	config_fields() {
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
				regex: this.REGEX_IP,
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
	 * Populates the supported actions.
	 */
	actions(system) {
		this.setActions({
			start_channel: {
				label: 'Start a Channel',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.channels_list,
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
						choices: this.channels_list,
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
						choices: this.channels_list,
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
						choices: this.channels_list,
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
	action(action) {
		let opt = action.options
	
		try {
			switch (action.action) {
				case 'start_channel':
					this.control_channel(opt.channel, 'start')
					break
				case 'stop_channel':
					this.control_channel(opt.channel, 'stop')
					break
				case 'start_channel_all':
					this.channels.forEach(x => this.control_channel(x.id, 'start'))
					break
				case 'stop_channel_all':
					this.channels.forEach(x => this.control_channel(x.id, 'stop'))
					break
				case 'arm_recording':
					this.control_channel(opt.channel, 'recording/start')
					break
				case 'disarm_recording':
					this.control_channel(opt.channel, 'recording/stop')
					break
			}
		} catch (err) {
			this.log('error', 'Error Executing Action: ' + err.message)
		}
	}
	
	/**
	 * Makes the complete URL.
	 *
	 * @param cmd Must start with a /
	 */
	makeUrl(cmd) {
		if (cmd[0] !== '/') {
			throw new Error('cmd must start with a /')
		}
	
		return 'https://' + this.config.host + cmd
	}

	disconnect() {
		clearInterval(this.polling)
		clearInterval(this.polling_login)
	}

	destroy() {
		this.disconnect()
	}
}

exports = module.exports = instance

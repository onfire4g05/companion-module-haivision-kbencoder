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
		this.defineConst('TIMEOUT_RECONNECT', 2500) // Time to wait on errors before attempting to reconnect to the server
		this.defineConst('TIMEOUT_LOGIN', 5000) // Timeout for login
		this.defineConst('TIMEOUT_GENERAL', 7000) // Timeout for http status calls
		this.defineConst('LOGIN_RETRY', 5) // Time, in seconds, to wait for retry when a login fails
		this.defineConst('RUN_STATES', [
			{ id: 'start_pending', label: 'Starting' },
			{ id: 'running', label: 'Running' },
			{ id: 'idle', label: 'Idle' },
			{ id: 'pre_stop_pending', label: 'Preparing to Stop' },
			{ id: 'stop_pending', label: 'Stopping' },
		])
		this.defineConst('RUN_STATUS', [
			{ id: '', label: 'Unknown/Inactive' },
			{ id: '1', label: 'Warning' },
			{ id: '2', label: 'Error' },
			{ id: '3', label: 'OK' },
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
		this.reconnect()
	}

	reconnect(timeout = 0) {
		this.disconnect()
		this.polling = setTimeout(this.init.bind(this), timeout)
	}

	getStatusName(status) {
		let status_obj = this.RUN_STATUS.find(x => x.id == status)
		if(!status_obj) status_obj = this.RUN_STATUS.find(x => x.id == '')
		
		return status_obj.label
	}

	init_feedbacks() {
		const feedbacks = {
			state: {
				type: 'boolean',
				label: 'Channel state',
				description: 'This feedback is true if selected channel is in a specified state.',
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
			},
			input_status: {
				type: 'boolean',
				label: 'Channel input status',
				description: 'This feedback is true if selected channel is in a specified status.',
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
						label: 'Status',
						id: 'status',
						choices: this.RUN_STATUS
					}
				],
				callback: (feedback) => {
					return this.channels.some(channel => channel.id === feedback.options.channel
						&& feedback.options.status == channel.input_status)
				}
			},
			output_status: {
				type: 'boolean',
				label: 'Channel output status',
				description: 'This feedback is true if selected channel is in a specified status.',
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
						label: 'Status',
						id: 'status',
						choices: this.RUN_STATUS
					}
				],
				callback: (feedback) => {
					return this.channels.some(channel => channel.id === feedback.options.channel
						&& feedback.options.status == channel.output_status)
				}
			},
			armed: {
				type: 'boolean',
				label: 'Channel armed',
				description: 'This feedback is true based on armed status.',
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
						label: 'Armed',
						id: 'armed',
						choices: [
							{ id: 'Yes', label: 'Yes' },
							{ id: 'No', label: 'No' },
						]
					}
				],
				callback: (feedback) => {
					return this.channels.some(channel => channel.id === feedback.options.channel
						&& feedback.options.armed === channel.recording_armed)
				}
			},
		}

		this.setFeedbackDefinitions(feedbacks)
	}

	init_login() {
		if(!('username' in this.config) || !('password' in this.config) || this.config.username === '' || this.config.password === '') {
			return
		}

		//username and password not blank, so initiate login session
		const body = {
			username: this.config.username,
			password: this.config.password,
		}

		this.status(this.STATUS_UNKNOWN, 'Logging in')
		const cmd = '/api/session'
		request.post({
			url: this.makeUrl(cmd),
			json: body,
			timeout: this.TIMEOUT_LOGIN,
		}, (error, response, body) => {
			if(typeof response !== 'object' || !('statusCode' in response) || response.statusCode !== 200) {
				this.log('warn', `Could not connect to server... will retry in ${this.LOGIN_RETRY} seconds`)
				this.status(this.STATUS_ERROR)
				this.polling_login = setTimeout(this.init_login.bind(this), this.LOGIN_RETRY * 1000)
				return
			}
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
	
	getSystemStatus() {
		return new Promise((resolve, reject) => {
			const cmd = '/api/system'
			request.get(this.getRequestOptions(cmd), (error, response, body) => {
				try {
					let data = JSON.parse(body)
		
					if (data.version) {
						this.setVariable('current_version', data.version.release + ' Build ' + data.version.build)
					}
		
					if (data.uptime) {
						this.setVariable('uptime', `${data.uptime.days}d${data.uptime.hrs}h${data.uptime.mins}m${data.uptime.secs}s`)
					}
					resolve()
				} catch(e) {
					this.debug(e)
					reject()
				}
			})
		})
	}

	getDeviceStatus() {
		return new Promise((resolve, reject) => {
			const cmd = '/api/devices'
			request.get(this.getRequestOptions(cmd), (error, response, body) => {
				try {
					let data = JSON.parse(body)
		
					if (data[0]) {
						this.deviceId = data[0]['_id']
						this.setVariable('device_name', data[0].name)
					}
					resolve()
				} catch (e) {
					this.debug(e)
					reject()
				}
			})
		})
	}

	get_variables() {
		const status_all = [this.getSystemStatus()]

		// Get Device Information
		if (this.deviceId === null) {
			status_all.push(this.getDeviceStatus())
		}

		Promise.all(status_all).then(() => {
			if (this.deviceId === null) {
				this.polling = setTimeout(this.get_variables.bind(this), this.POLLING_INTERVAL)
				return
			} else {
				Promise.all([
					this.get_channels(this.deviceId),
					this.get_statistics(this.deviceId)
				]).then(() => {
					this.polling = setTimeout(this.get_variables.bind(this), this.POLLING_INTERVAL)
				}).catch(() => {
					this.log('warn', 'Problem during polling channels/stats. Will reconnect to server soon.')
					this.reconnect(this.TIMEOUT_RECONNECT)
				})
			}
		}).catch(() => {
			// Problem, should probably disconnect and try again
			this.log('warn', 'Problem during polling system status. Will reconnect to server soon.')
			this.reconnect(this.TIMEOUT_RECONNECT)
		})
	}
	
	_channelStateVariableName(channel_name, name = 'state') {
		return name + '_' + unescape(channel_name).replace(' ', '_')
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
		}, {
			label: `Channel ${channel.name} output status`,
			name: this._channelStateVariableName(channel.name, 'output')
		}, {
			label: `Channel ${channel.name} output info`,
			name: this._channelStateVariableName(channel.name, 'output_info')
		}, {
			label: `Channel ${channel.name} input status`,
			name: this._channelStateVariableName(channel.name, 'input')
		}, {
			label: `Channel ${channel.name} input info`,
			name: this._channelStateVariableName(channel.name, 'input_info')
		}, {
			label: `Channel ${channel.name} is armed`,
			name: this._channelStateVariableName(channel.name, 'armed')
		})

		this.channels_list.push({
			id: channel._id,
			label: unescape(channel.name)
		})
	}

	_updateChannel(channel) {
		const id = this.channels.findIndex(x => x.id === channel._id)

		this.channels[id].recording_armed = channel.recording === 'active' ? 'Yes' : 'No'
		this.channels[id].state = channel.state
		this.channels[id].output_status = 'outputstate' in channel ? channel.outputstate : '' // case is correct here!
		this.channels[id].input_status = 'inputstate' in channel ? channel.inputstate : ''

		this.setVariable(this._channelStateVariableName(channel.name), channel.state)

		this.setVariable(this._channelStateVariableName(channel.name, 'output'), this.getStatusName(this.channels[id].output_status))
		this.setVariable(this._channelStateVariableName(channel.name, 'output_info'), 'outputStateInfo' in channel ? channel.outputStateInfo : '')
		
		this.setVariable(this._channelStateVariableName(channel.name, 'input'), this.getStatusName(this.channels[id].input_status))
		this.setVariable(this._channelStateVariableName(channel.name, 'input_info'), 'inputStateInfo' in channel ? channel.inputStateInfo : '')

		this.setVariable(this._channelStateVariableName(channel.name, 'armed'), this.channels[id].recording_armed)
	}

	isChannel(channel_id) {
		return this.channels.find(x => x.id === channel_id)
	}

	get_channels(deviceId) {
		return new Promise((resolve, reject) => {
			const cmd = `/api/kulabyte/${deviceId}/channels`
			request.get(this.getRequestOptions(cmd), (error, response, body) => {
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
					this.checkFeedbacks('input_status')
					this.checkFeedbacks('output_status')
					this.checkFeedbacks('armed')
					resolve()
				} catch(e) {
					this.debug(e)
					reject()
				}
			})
		});
	}
	
	get_statistics(deviceId) {
		return new Promise((resolve, reject) => {
			const cmd = `/api/kulabyte/${deviceId}/encoder/statistics`
			request.get(this.getRequestOptions(cmd), (error, response, body) => {
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
					resolve()
				} catch(e) {
					this.debug(e)
					reject()
				}
			})
		})
	}
	
	control_channel(channelId, command) {
		const cmd = `/api/kulabyte/${this.deviceId}/channels/${channelId}/${command}`
		request.post(this.getRequestOptions(cmd), (error, response, body) => {
			//let data = JSON.parse(body)
		})
	}
	
	getRequestOptions(cmd) {
		const url = this.makeUrl(cmd)
		let cookieJarAuth = request.jar()
		const cookie = request.cookie('sessionID=' + this.sessionId)
		cookieJarAuth.setCookie(cookie, url)

		return {
			url: url,
			jar: cookieJarAuth,
			timeout: this.TIMEOUT_GENERAL
		}
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
		clearTimeout(this.polling)
		clearTimeout(this.polling_login)
	}

	destroy() {
		this.disconnect()
	}
}

exports = module.exports = instance

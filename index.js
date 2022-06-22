// Haivision KB Encoder

const instance_skel = require('../../instance_skel')

const request = require('request').defaults({
	rejectUnauthorized: false,
});

class instance extends instance_skel {
	constructor(system, id, config) {
		super(system, id, config)
		this.defineConst('POLLING_INTERVAL', 1000)
		this.defineConst('REAUTH_TIME', 1200000)

		this.actions()
	}

	init() {
		this.sessionId = null
		this.deviceId = null
		this.polling = null
		this.channels = []
		this.channels_list = [{ id: 'null', label: '(no channels found)' }]
		this.Variables = [
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
		this.setVariableDefinitions(this.Variables)
	}

	updateConfig(config) {
		this.config = config
		this.disconnect()
		this.init()
	}

	init_feedbacks() {
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
					choices: this.channels_list,
				},
				{
					type: 'colorpicker',
					label: 'Foreground Color',
					id: 'fg',
					default: this.rgb(0, 0, 0),
				},
				{
					type: 'colorpicker',
					label: 'Background Color',
					id: 'bg',
					default: this.rgb(0, 255, 0),
				},
			],
		}
	
		this.setFeedbackDefinitions(feedbacks)
	}

	feedback(feedback, bank) {
		if (feedback.type === 'state') {
			for (let i = 0; i < this.channels.length; i++) {
				if (this.channels[i].id === feedback.options.channel) {
					if (this.channels[i].state === 'running') {
						return { color: feedback.options.fg, bgcolor: feedback.options.bg }
					}
				}
			}
		}
	
		return {}
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
		let self = this
	
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
	
	get_channels(deviceId) {
		let cmd, url, cookieJarAuth, cookie1
	
		cmd = `/api/kulabyte/${deviceId}/channels?_=${this.getTime()}`
		url = this.makeUrl(cmd)
		cookieJarAuth = request.jar()
		cookie1 = request.cookie('sessionID=' + this.sessionId)
		cookieJarAuth.setCookie(cookie1, url)
	
		request.get({ url: url, jar: cookieJarAuth }, (error, response, body) => {
			try {
				let data = JSON.parse(body)
	
				let newChannels = false
				console.log(data)
	
				for (let i = 0; i < data.length; i++) {
					if (data[i]) {
						const found = this.channels_list.some((el) => el.id === data[i]['_id'])
						if (!found) {
							let channelObj = {}
							channelObj.id = data[i]['_id']
							channelObj.name = data[i].name
							channelObj.recordingArmed = data[i].recording === 'active' ? true : false
							channelObj.state = data[i].state
							this.channels.push(channelObj)
	
							let channelListObj = {}
							channelListObj.id = data[i]['_id']
							channelListObj.label = unescape(data[i].name)
							this.channels_list.push(channelListObj)
	
							newChannels = true //set the bool to true so we can later update actions/feedbacks list
						} else {
							//update the channel state
							let index = this.channels.findIndex((obj) => obj.id == data[i]['_id'])
	
							this.channels[index].name = data[i].name
							this.channels[index].recordingArmed = data[i].recording === 'active' ? true : false
							this.channels[index].state = data[i].state
						}
	
						let foundStateVariable = false
						let channel_name = unescape(data[i].name).replace(' ', '_')
	
						for (let i = 0; i < this.Variables.length; i++) {
							if (this.Variables[i].name === 'state_' + channel_name) {
								foundStateVariable = true
							}
						}
	
						if (!foundStateVariable) {
							let variableObj = {}
							variableObj.name = 'state_' + channel_name
							this.Variables.push(variableObj)
						}
	
						if (!foundStateVariable) {
							//only set the variable definitions again if we added a new variable, this should cut down on unneccessary requests
							this.setVariableDefinitions(this.Variables)
						}
	
						this.setVariable('state_' + channel_name, data[i].state)
						this.checkFeedbacks('state')
						
						if (newChannels) {
							this.actions() //republish list of actions because of new channel data
							this.init_feedbacks() //republish list of feedbacks because of new channel data
						}
					}
				}
	
				if (newChannels) {
					this.actions() //republish list of actions because of new channel data
					this.init_feedbacks() //republish list of feedbacks because of new channel data
				}
			} catch(e) {
				this.debug(e)
			}
		})
	}
	
	get_statistics(deviceId) {
		let self = this
	
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
		let self = this
	
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
		let self = this
	
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
					for (let i = 0; i < this.channels_list.length; i++) {
						this.control_channel(this.channels_list[i].id, 'start')
					}
					break
				case 'stop_channel_all':
					for (let i = 0; i < this.channels_list.length; i++) {
						this.control_channel(this.channels_list[i].id, 'stop')
					}
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

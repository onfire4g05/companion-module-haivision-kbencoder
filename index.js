// Haivision KB Encoder

import { InstanceBase, Regex, combineRgb, runEntrypoint } from '@companion-module/base'

import UpgradeScripts from './upgrades.js'
import got from 'got'
import { CookieJar } from 'tough-cookie'

class HaivisionKbEncoderInstance extends InstanceBase {
	async init(config) {
		this.config = config

		this.POLLING_INTERVAL = 1000
		this.REAUTH_TIME = 1200000
		this.TIMEOUT_RECONNECT = 2500 // Time to wait on errors before attempting to reconnect to the server
		this.TIMEOUT_LOGIN = 5000 // Timeout for login
		this.TIMEOUT_GENERAL = 7000 // Timeout for http status calls
		this.LOGIN_RETRY = 5 // Time, in seconds, to wait for retry when a login fails
		this.RUN_STATES = [
			{ id: 'start_pending', label: 'Starting' },
			{ id: 'running', label: 'Running' },
			{ id: 'idle', label: 'Idle' },
			{ id: 'pre_stop_pending', label: 'Preparing to Stop' },
			{ id: 'stop_pending', label: 'Stopping' },
		]
		this.RUN_STATUS = [
			{ id: '', label: 'Unknown/Inactive' },
			{ id: '1', label: 'Warning' },
			{ id: '2', label: 'Error' },
			{ id: '3', label: 'OK' },
		]

		this.cookieJar = new CookieJar()

		this.actions()

		this.variables = [
			{
				name: 'Current Software Version',
				variableId: 'current_version',
			},
			{
				name: 'Current CPU Usage',
				variableId: 'current_cpu_usage',
			},
			{
				name: 'Current Memory Usage',
				variableId: 'current_mem_usage',
			},
			{
				name: 'Free Disk Space (GB)',
				variableId: 'free_disk_space',
			},
			{
				name: 'Total Disk Space (GB)',
				variableId: 'total_disk_space',
			},
			{
				name: 'Used Disk Space (Percent)',
				variableId: 'used_disk_space',
			},
			{
				name: 'Device Name',
				variableId: 'device_name',
			},
			{
				name: 'Uptime (Hours)',
				variableId: 'uptime',
			},
			{
				name: 'Network Incoming',
				variableId: 'network_incoming',
			},
			{
				name: 'Network Outgoing',
				variableId: 'network_outgoing',
			},
		]

		this.setVariableDefinitions(this.variables)
		this.init_feedbacks()
		this.init_login()
	}

	async configUpdated(config) {
		this.disconnect()
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
					color: combineRgb(255,255,255),
					bgcolor: combineRgb(51, 102, 0)
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
					color: combineRgb(255,255,255),
					bgcolor: combineRgb(51, 102, 0)
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
					color: combineRgb(255,255,255),
					bgcolor: combineRgb(51, 102, 0)
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
					color: combineRgb(255,255,255),
					bgcolor: combineRgb(51, 102, 0)
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

	async init_login() {
		if(!('username' in this.config) || !('password' in this.config) || this.config.username === '' || this.config.password === '') {
			return
		}

		this.sessionId = null
		this.deviceId = null
		this.polling = null
		this.channels = []
		this.channels_list = [{ id: 'null', label: '(no channels found)' }]

		//username and password not blank, so initiate login session
		const body = {
			username: this.config.username,
			password: this.config.password,
		}

		this.updateStatus('connecting')
		const cmd = '/api/session'
		await got.post(this.makeUrl(cmd), {
			json: body,
			timeout: {
				request: this.LOGIN_TIMEOUT,
			},
			https: {
				rejectUnauthorized: false,
			},
		}).then(async response => {
			if(typeof response !== 'object' || !('statusCode' in response) || response.statusCode !== 200) {
				this.log('warn', `Could not connect to server... will retry in ${this.LOGIN_RETRY} seconds`)
				this.updateStatus('connection_failure')
				this.polling_login = setTimeout(this.init_login.bind(this), this.LOGIN_RETRY * 1000)
				return
			}

			// Success
			this.sessionId = null
			this.cookies = response.headers['set-cookie']
			let cookiesArray = this.cookies[0].split(';')
			await this.cookieJar.setCookie(this.cookies[0], 'https://' + this.config.host)

			for (let i = 0; i < cookiesArray.length; i++) {
				if (cookiesArray[i].indexOf('sessionID=') > -1) {
					//this is the session id that we want
					let values = cookiesArray[i].split('=')
					this.sessionId = values[1]
					break
				}
			}

			if (this.sessionId !== null) {
				this.updateStatus('ok')
				this.log('info', 'Session authenticated. Session ID: ' + this.sessionId)

				this.get_variables()
				
				this.polling_login = setTimeout(() => {
					this.log('info', 'Reauthenticating Login Session.')
					this.init_login()
				}, this.REAUTH_TIME)
			} else {
				this.updateStatus('connection_failure')
				this.log('error', 'Login error: Session ID not returned.')
			}
		}).catch(e => {
			this.updateStatus('connection_failure')
			this.log('error', 'Login error parsing cookies: ' + e.message)
		})
	}
	
	async getSystemStatus() {
		const cmd = '/api/system'
		const data = await got.get(this.makeUrl(cmd), this.getRequestOptions())
			.json()
			.catch(e => this.log('error', 'Error getting system status: ' + e.message))

		if(data) {
			this.setVariableValues({ current_version: data.version.release + ' Build ' + data.version.build })
			this.setVariableValues({ uptime: `${data.uptime.days}d${data.uptime.hrs}h${data.uptime.mins}m${data.uptime.secs}s` })
		}
	}

	async getDeviceStatus() {
		const data = await got.get(this.makeUrl('/api/devices'), this.getRequestOptions())
			.json()
			.catch(e => this.log('debug', e))

		if(data && data[0]) {
			this.deviceId = data[0]['_id']
			this.setVariableValues({ device_name: data[0].name })
		}
	}

	async get_variables() {
		const status_all = [await this.getSystemStatus()]

		// Get Device Information
		if (this.deviceId === null) {
			status_all.push(await this.getDeviceStatus())
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
		return name + '_' + unescape(channel_name).replaceAll(' ', '_')
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
			name: `Channel ${channel.name} state`,
			variableId: this._channelStateVariableName(channel.name)
		}, {
			name: `Channel ${channel.name} output status`,
			variableId: this._channelStateVariableName(channel.name, 'output')
		}, {
			name: `Channel ${channel.name} output info`,
			variableId: this._channelStateVariableName(channel.name, 'output_info')
		}, {
			name: `Channel ${channel.name} input status`,
			variableId: this._channelStateVariableName(channel.name, 'input')
		}, {
			name: `Channel ${channel.name} input info`,
			variableId: this._channelStateVariableName(channel.name, 'input_info')
		}, {
			name: `Channel ${channel.name} is armed`,
			variableId: this._channelStateVariableName(channel.name, 'armed')
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

		this.setVariableValues({
			[this._channelStateVariableName(channel.name)]: channel.state,
			[this._channelStateVariableName(channel.name, 'output')]: this.getStatusName(this.channels[id].output_status),
			[this._channelStateVariableName(channel.name, 'output_info')]: 'outputStateInfo' in channel ? channel.outputStateInfo : '',
			[this._channelStateVariableName(channel.name, 'input')]: this.getStatusName(this.channels[id].input_status),
			[this._channelStateVariableName(channel.name, 'input_info')]: 'inputStateInfo' in channel ? channel.inputStateInfo : '',
			[this._channelStateVariableName(channel.name, 'armed')]: this.channels[id].recording_armed,
		})
	}

	isChannel(channel_id) {
		return this.channels.find(x => x.id === channel_id)
	}

	async get_channels(deviceId) {
		const channel_list = await got.get(this.makeUrl(`/api/kulabyte/${deviceId}/channels`), this.getRequestOptions())
			.json()
			.catch(e => this.log('debug', e))
		
		if(channel_list) {
			let new_channels = false

			if (!Array.isArray(channel_list)) {
				this.log('warn', 'Invalid data from server... expected an array')
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
				this.setVariableDefinitions(this.variables)
				this.actions()
				this.init_feedbacks()
			}

			this.checkFeedbacks('state')
			this.checkFeedbacks('input_status')
			this.checkFeedbacks('output_status')
			this.checkFeedbacks('armed')
		}
	}
	
	async get_statistics(deviceId) {
		const data = got.get(this.makeUrl(`/api/kulabyte/${deviceId}/encoder/statistics`), this.getRequestOptions())
			.json()
			.catch(e => this.log('debug', e))

		if(data) {
			const updatedVars = {
				current_cpu_usage: data.cpu,
				current_mem_usage: data.memory,
			}

			if (data.diskSpace) {
				updatedVars[free_disk_space] = data.diskSpace.free
				updatedVars[total_disk_space] = data.diskSpace.total
				updatedVars[used_disk_space] = data.diskSpace.usedPercent
			}

			if (data.network) {
				updatedVars[network_incoming] = data.network.incoming
				updatedVars[network_outgoing] = data.network.outgoing
			}
			this.setVariableValues(updatedVars)
		}
	}
	
	async control_channel(channelId, command) {
		const cmd = `/api/kulabyte/${this.deviceId}/channels/${channelId}/${command}`
		const data = await got.post(this.makeUrl(cmd), this.getRequestOptions())
			.json()
			.catch(e => this.log('debug', e))
	}
	
	getRequestOptions(cmd) {
		return {
			cookieJar: this.cookieJar,
			timeout: {
				request: this.TIMEOUT_GENERAL,
			},
			https: {
				rejectUnauthorized: false,
			},
		}
	}

	/**
	 * Return config fields for web config.
	 */
	getConfigFields() {
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
				regex: Regex.IP,
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
	actions() {
		this.setActionDefinitions({
			start_channel: {
				name: 'Start a Channel',
				options: [
					{
						type: 'dropdown',
						name: 'Channel',
						id: 'channel',
						choices: this.channels_list,
					},
				],
				callback: evt => this.control_channel(evt.options.channel, 'start')
			},
			stop_channel: {
				name: 'Stop a Channel',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.channels_list,
					},
				],
				callback: evt => this.control_channel(evt.options.channel, 'stop')
			},
			start_channel_all: {
				name: 'Start All Channels',
				options: [],
				callback: () => this.channels.forEach(x => this.control_channel(x.id, 'start'))
			},
			stop_channel_all: {
				name: 'Stop All Channels',
				options: [],
				callback: () => this.channels.forEach(x => this.control_channel(x.id, 'stop'))
			},
			arm_recording: {
				name: 'Arm Recording',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.channels_list,
					},
				],
				callback: evt => this.control_channel(evt.options.channel, 'recording/start')
			},
			disarm_recording: {
				name: 'Disarm Recording',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.channels_list,
					},
				],
				callback: evt => this.control_channel(evt.options.channel, 'recording/stop')
			},
		})
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

	async destroy() {
		this.disconnect()
	}
}

runEntrypoint(HaivisionKbEncoderInstance, UpgradeScripts)

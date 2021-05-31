// Haivision KB Encoder

var instance_skel = require('../../instance_skel');
var debug;
var log;

function instance(system, id, config) {
	var self = this;

	// super-constructor
	instance_skel.apply(this, arguments);

	self.actions();

	return self;
};

instance.prototype.sessionId = null;
instance.prototype.polling = null;

instance.prototype.channels = [];
instance.prototype.channels_list = [];

/**
 * Config updated by the user.
 */
instance.prototype.updateConfig = function(config) {
	let self = this;
	self.config = config;
	clearInterval(self.polling);
	self.init_variables();
	self.init_login();
};

/**
 * Initializes the module.
 */
instance.prototype.init = function() {
	let self = this;

	self.init_variables();
	self.init_login();
};

instance.prototype.init_variables = function() {
	let self = this;

	self.setVariableDefinitions(
		[
			{
				label: 'Current CPU Usage',
				name: 'current_cpu_usage'
			},
			{
				label: 'Current Memory Usage',
				name: 'current_mem_usage'
			},
			{
				label: 'Free Disk Space (GB)',
				name: 'free_disk_space'
			},
			{
				label: 'System Memory Usage',
				name: 'system_mem_usage'
			},
			{
				label: 'System Memory Usage (Percent)',
				name: 'system_mem_usage_percent'
			},
			{
				label: 'System Total Memory',
				name: 'system_total_memory'
			},
			{
				label: 'Total Disk Space (GB)',
				name: 'total_disk_space'
			},
			{
				label: 'Used Disk Space (Percent)',
				name: 'used_disk_space'
			},
			{
				label: 'Encoder Label',
				name: 'encoder_label'
			},
			{
				label: 'Encoder Uptime (Hours)',
				name: 'encocder_uptime'
			}
		]
	);
};

instance.prototype.init_login = function() {
	var self = this;

	if ((self.config.username !== '') && (self.config.password !== '')) {
		//username and password not blank, so initiate login session
		let body = {
			"username": self.config.username,
			"password": self.config.password
		}

		let cmd = '/ecs/auth.json';
		self.postRest(cmd, body).then(function(result) {
			// Success
			self.status(self.STATUS_OK);
			let resultdata = JSON.parse(result.data.toString());
			self.sessionId = resultdata['sessionid'];

			self.polling = setInterval(() => {
				self.get_variables();
			}, 10000); //10 seconds
		}).catch(function(message) {
			self.sessionId = null;
			self.status(self.STATUS_ERROR);
			self.log('error', self.config.host + ' : ' + message);
		});
	}
};

instance.prototype.get_variables = function() {
	// GET /ecs.json
	/*
	encoder.CurrentCpuUsage
	encoder.CurrentMemUsage
	encoder.FreeDiskSpaceGB
	encoder.SystemMemUsage
	encoder.SystemMemUsagePercent
	encoder.SystemTotalMemory
	encoder.TotalDiskSpaceGB
	encoder.UsedDiskSpacePercent
	encoder.channels
		event_id
		event_label
		id
		label
		outoforder
		port
		startcounter
	encoder.label
	encoder.uptime.hours
	*/

	let self = this;

	let cmd = '/ecs.json';
	self.getRest(cmd, {}).then(function(result) {
		// Success
		//process the data
		self.status(self.STATUS_OK);
		let data = JSON.parse(result.data.toString());

		self.setVariable('current_cpu_usage', data['CurrentCpuUsage']);
		self.setVariable('current_mem_usage', data['CurrentMemUsage']);
		self.setVariable('free_disk_space', data['FreeDiskSpaceGB']);
		self.setVariable('system_mem_usage', data['SystemMemUsage']);
		self.setVariable('system_mem_usage_percent', data['SystemMemUsagePercent']);
		self.setVariable('system_total_memory', data['SystemTotalMemory']);
		self.setVariable('total_disk_space', data['TotalDiskSpaceGB']);
		self.setVariable('used_disk_space', data['UsedDiskSpacePercent']);
		self.setVariable('encoder_label', data['label']);
		self.setVariable('encoder_uptime', data['uptime']['hours']);

		self.channels = [];
		self.channels_list = [];

		for (let i = 0; i < data['channels'].length; i++) {
			self.channels.push(data['channels'][i]);
			let channelListObj = {};
			channelListObj.id = data['channels'][i].label;
			channelListObj.label = data['channels'][i].label;
			self.channels_list.push(channelListObj);

			self.get_channel_state(data['channels'][i].label);
		}

		self.actions(); //republish list of actions because of new channel data
	}).catch(function(message) {
		clearInterval(self.polling);
		self.status(self.STATUS_ERROR);
		self.log('error', self.config.host + ' : ' + message);
	});
}

instance.prototype.get_channel_state = function(channel_id) {
	/*
	GET /ecs/channels/<channel_id>.json
	channel.state (running)
	*/

	let self = this;

	let cmd = `/ecs/channels/${channel_id}.json`;
	self.getRest(cmd, {}).then(function(result) {
		// Success
		let data = JSON.parse(result.data.toString());
		self.setVariable(channel_id + '_state', data['channel']['state']);
	}).catch(function(message) {
		self.status(self.STATUS_ERROR);
		self.log('error', self.config.host + ' : ' + message);
	});
};

instance.prototype.control_channel = function(channel_id, command, param) {
	let self = this;

	/*
	StartChannel
	StartChannel param "startrecord"
	StopChannel
	PrepareStop
	StartRecord
	StopRecord
	*/

	let cmd = `/ecs/channels/${channel_id}.json`;
	let body = {
		"invoke":
		{
			"command": command,
			"param": param
		}
	}

	self.putRest(cmd, body).then(function(result) {
		let data = JSON.parse(result.data.toString());
		let message = data['messages'][0]['text'];
		self.log('info', message);
	}).catch(function(message) {
		self.status(self.STATUS_ERROR);
		self.log('error', self.config.host + ' : ' + message);
	});
};


/**
 * Return config fields for web config.
 */
instance.prototype.config_fields = function() {
	var self = this;

	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This module will control a Haivision KB Encoder.'
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'IP Address',
			width: 4,
			regex: self.REGEX_IP
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 4
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'Password',
			width: 4
		}
	];

};


/**
 * Cleanup when the module gets deleted.
 */
instance.prototype.destroy = function() {
	var self = this;
	debug("destroy");
};


/**
 * Populates the supported actions.
 */
instance.prototype.actions = function(system) {
	var self = this;

	self.setActions({
		'start_streaming': {
			label: 'Start Streaming',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list
				}
			]
		},
		'stop_streaming': {
			label: 'Stop Streaming',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list
				}
			]
		},
		'start_recording': {
			label: 'Start Recording',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list
				}
			]
		},
		'stop_recording': {
			label: 'Stop Recording',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: self.channels_list
				}
			]
		}

	});
};


instance.prototype.getRest = function(cmd, body) {
	var self = this;
	return self.doRest('GET', cmd, body);
};

instance.prototype.postRest = function(cmd, body) {
	var self = this;
	return self.doRest('POST', cmd, body);
};

instance.prototype.putRest = function(cmd, body) {
	var self = this;
	return self.doRest('PUT', cmd, body);
};

/**
 * Performs the REST command, either GET, POST, or PUT.
 *
 * @param method        Either GET, POST, or PUT
 * @param cmd           The command to execute
 * @param body          If POST or PUT, an object containing the body
 */
instance.prototype.doRest = function(method, cmd, body) {
	var self = this;
	var url  = self.makeUrl(cmd);

	return new Promise(function(resolve, reject) {

		function handleResponse(err, result) {
			if (err === null && typeof result === 'object' && result.response.statusCode === 200) {
				// A successful response
				resolve(result);
			} else {
				// Failure. Reject the promise.
				var message = 'Unknown error';

				if (result !== undefined) {
					if (result.response !== undefined) {
						message = result.response.statusCode + ': ' + result.response.statusMessage;
					} else if (result.error !== undefined) {
						// Get the error message from the object if present.
						message = result.error.code +': ' + result.error.message;
					}
				}

				reject(message);
			}
		}

		let headers = {};

		if (self.sessionId !== null) {
			headers['Authorization'] = self.sessionId;
		}

		let extra_args = {};

		switch(method) {
			case 'POST':
				self.system.emit('rest', url, body, function(err, result) {
						handleResponse(err, result);
					}, headers, extra_args
				);
				break;

			case 'GET':
				self.system.emit('rest_get', url, function(err, result) {
						handleResponse(err, result);
					}, headers, extra_args
				);
				break;

			case 'PUT':
				self.system.emit('rest_put', url, function(err, result) {
						handleResponse(err, result);
					}, headers, extra_args
				);
				break;

			default:
				throw new Error('Invalid method');

		}

	});

};


/**
 * Runs the specified action.
 *
 * @param action
 */
instance.prototype.action = function(action) {
	var self = this;
	var opt = action.options;

	try {
		switch (action.action) {
			case 'start_streaming':
				self.control_channel(opt.channel, 'StartChannel', '');
				break;
			case 'stop_streaming':
				self.control_channel(opt.channel, 'StopChannel', '');
				break;
			case 'start_recording':
				self.control_channel(opt.channel, 'StartRecord', '');
				break;
			case 'stop_recording':
				self.control_channel(opt.channel, 'StopRecord', '');
				break;
		}

	} catch (err) {
		self.log('error', err.message);
	}
};

/**
 * Makes the complete URL.
 *
 * @param cmd           Must start with a /
 */
instance.prototype.makeUrl = function(cmd) {
	var self = this;

	if (cmd[0] !== '/') {
		throw new Error('cmd must start with a /');
	}

	return 'http://' + self.config.host + cmd;
};

instance_skel.extendedBy(instance);
exports = module.exports = instance;
require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var RSVP = require('rsvp');

RSVP.configure('onerror', function (error) {
	console.error(error.message);
	console.error(error.stack);
});

module.exports = {
	repositories: require('./lib/repositories'),
	ORM: require('./lib/orm'),
	decorators: require('./lib/decorators'),
	utils: require('./lib/utils')
};
},{"./lib/decorators":3,"./lib/orm":6,"./lib/repositories":11,"./lib/utils":24,"rsvp":"rsvp"}],2:[function(require,module,exports){
var _ = require('underscore');

var EmberDecorator = {
	unknownProperty: function (key) {
		return this.get(key);
	},

	get: function (key) {
		var prop = this.getSchema().getProperty(key);

		if (prop !== undefined)
			return this._super(key);

		if (this[key] !== undefined)
			return this[key];
	},

	setUnknownProperty: function (key, value) {
		return this.set(key, value);
	},

	set: function (key, value) {
		var self = this;

		// If key is an object, we're trying to set multiple props
		if (_.isObject(key)) {
			_.each(key, function (val, name) {
				self.set(name, val);
			});
			return this;
		}

		var prop = this.getSchema().getProperty(key);

		Ember.propertyWillChange(this, key);

		if (prop !== undefined)
			this._super(key, value);

		if (this[key] !== undefined)
			this[key] = value;

		Ember.propertyDidChange(this, key);

		return this;
	},

	reload: function () {
		// Get a list of the changed values
		var currentData = this.getData(),
			self = this;

		return this._super().then(function (obj) {
			var newData = obj.getData(),
				changedFields = [];

			_.each(newData, function (value, key) {
				if (currentData[key] !== value)
					changedFields.push(key);
			});

			_.each(changedFields, function (key) {
				Ember.propertyWillChange(self, key);
				Ember.propertyDidChange(self, key);
			});
		});
	}
};

module.exports = EmberDecorator;
},{"underscore":"underscore"}],3:[function(require,module,exports){
module.exports = {
	Ember: require('./ember')
};
},{"./ember":2}],4:[function(require,module,exports){
var utils = require('./../utils'),
	RSVP = require('rsvp'),
	_ = require('underscore');

/**
 * The BaseModel is what all Intaglio objects are extended from. It provides the base functionality
 * required to make a functioning ORM.
 * @type {*}
 */
var BaseModel = utils.Class.extend({
	/**
	 * Stores the schema of the object
	 */
	_model: null,

	/**
	 * Stores the repository that the object uses for persistence
	 */
	_repository: null,

	/**
	 * Stores an instance of the logging module to allow for different logging implementations.
	 */
	_logger: null,

	/**
	 * Unique ID used to track the objects that have been created in the system
	 */
	_instanceId: null,

	/**
	 * Stores the data of the object as it was when it was last loaded from persistence to use
	 * to check for deltas on `save()`.
	 */
	_originalData: null,

	/**
	 * Current data of the model.
	 */
	_data: null,

	/**
	 * Stores all the event listeners registered with the object
	 */
	_events: null,

	/**
	 * Stores extended functionality to the model. Not Yet Implemented.
	 */
	_extensions: null,

	/**
	 * Flag for maintaining the state of if the model is in persistence.
	 */
	_isNew: true,

	/**
	 * Flag for maintaining the state of the model being deleted
	 */
	_isDeleted: false,

	/**
	 * Flag for maintaining the state of the model's instantiation
	 */
	_isSetup: false,

	/**
	 * Initialization function. Throws an exception as the class is abstract.
	 */
	init: function () {
		throw new utils.Exceptions.AbstractClassException();
	},

	/**
	 * Simple event registration.
	 * @param event
	 * @param callback
	 */
	on: function (event, callback) {
		utils.assert("Callback must be a function!", _.isFunction(callback));

		// Make sure object isn't deleted
		this._checkDeleted();

		// Setup the event container
		if (this._events[event] === undefined)
			this._events[event] = [];

		// Store the event handler
		this._events[event].push(callback);
	},

	/**
	 * Fires any event handlers for an event.
	 * @param event
	 */
	trigger: function (event, meta) {
		var self = this;

		// Make sure object isn't deleted
		this._checkDeleted();

		if (this._events[event] !== undefined) {
			// Fire each callback registered to the event
			_.each(this._events[event], function (callback) {
				callback.call(self, meta);
			});
		}

		if (this._orm.getEventHandlers(event) !== undefined) {
			// Fire each callback registered to the event
			_.each(this._orm.getEventHandlers(event), function (callback) {
				callback.call(self, meta);
			});
		}
	},

	/**
	 * Gets data from the model.
	 * @param key
	 * @returns {*}
	 */
	get: function (key) {
		// Make sure object isn't deleted
		this._checkDeleted();
		
		return this._data[key];
	},

	set: function (key, value) {
		// Make sure object isn't deleted
		this._checkDeleted();
		
		var self = this, old;

		// Handle passing objects
		if (_.isObject(key)) {
			_.each(key, function(v, k) {
				// Store the old value for the trigger
				old = self._data[k];

				self._data[k] = v;

				self.trigger('change', {
					key: k,
					from: old,
					to: v
				});
			});
		}
		else {
			// Store the old value for the trigger
			old = self._data[key];

			this._data[key] = value;

			self.trigger('change', {
				key: key,
				from: old,
				to: value
			});
		}

		return this;
	},

	save: function () {
		// Make sure object isn't deleted
		this._checkDeleted();
		
		var self = this, meta = {
			create: self._isNew,
			changed: self.getFieldsPendingChange()
		};

		this.trigger('save', meta);

		return new RSVP.Promise(function (resolve, reject) {
			var savePromise;

			// Do a create if it's new
			if (self._isNew) {
				savePromise = self._repository.create(self._model, self._model.translateObjectToRepository(self._data));
			}
			else {
				if (self.getFieldsPendingChange().length === 0) {
					self.trigger('saved', meta);
					return resolve(self);
				}
				savePromise = self._repository.save(self._model, self._model.translateObjectToRepository(self._originalData), self._model.translateObjectToRepository(self._data));
			}

			savePromise.then(function (data) {
				self._parseData(self._model.translateObjectToOrm(data));

				self.trigger('saved', meta);
				return resolve(self);
			}, reject);
		});
	},

	delete: function () {
		// Make sure object isn't deleted
		this._checkDeleted();
		
		var self = this;

		self.trigger('delete');

		return new RSVP.Promise(function (resolve, reject) {
			self._repository.delete(self._model, self._data).then(function () {
				self.trigger('deleted');

				// Mark it as dead
				self._isDeleted = true;

				return resolve(self);
			}, reject);
		});
	},

	reload: function () {
		// Make sure object isn't deleted
		this._checkDeleted();

		if (this._isNew)
			throw new utils.Exceptions.UnsavedModelException('Cannot reload a model that has not been saved!');
		
		var self = this;

		self.trigger('reload');

		return new RSVP.Promise(function (resolve, reject) {
			self._repository.reload(self._model, self._model.translateObjectToRepository(self._data)).then(function (data) {
				self._parseData(self._model.translateObjectToOrm(data));

				self.trigger('reloaded');
				return resolve(self);
			}, reject);
		});
	},

	getData: function () {
		return _.extend({}, this._data);
	},

	getPrimaryKey: function () {
		return this._model.getPrimaryKey();
	},

	getModelName: function () {
		return this._model.getName();
	},

	getSchema: function () {
		return this._model;
	},

	getFieldsPendingChange: function () {
		var changes = [],
			self = this;

		_.each(this._data, function (value, key) {
			if (self._originalData[key] !== value)
				changes.push(key);
		});

		return changes;
	},

	setup: function (instanceId, data, isNew) {
		if (this._isSetup)
			throw new utils.Exceptions.ModelInstantiationException("Cannot call setup() on a model that has already been setup!");

		var self = this;

		// Setup the instance vars
		this._originalData = {};
		this._data = {};
		this._events = {};
		this._conditions = [];
		this._isSetup = true;
		this._instanceId = instanceId;

		// Setup the fields
		_.each(this._model.getProperties(), function (property) {
			self._originalData[property.getName()] = null;
			self._data[property.getName()] = null;
		});

		this._parseData(data, isNew);
	},

	getClass: function () {
		return this._orm.getClass(this._model.getName());
	},

	_checkDeleted: function () {
		if (this._isDeleted)
			throw new utils.Exceptions.DeletedModelException();
	},

	_parseData: function (data, isNew){
		var self = this;

		if (isNew === undefined)
			isNew = false;

		// Mark it as no longer new
		self._isNew = isNew;

		// If there is any data, set it up
		if (data) {
			_.each(data, function (value, key) {
				var property = self._model.getProperty(key);

				if (property !== undefined){
					self._originalData[property.getName()] = value;
					self._data[property.getName()] = value;
				}
			});
		}
	}
});



module.exports = BaseModel;

},{"./../utils":24,"rsvp":"rsvp","underscore":"underscore"}],5:[function(require,module,exports){
var utils = require('./../utils'),
	RSVP = require('rsvp'),
	_ = require('underscore'),
	Where = require('./where');

var Factory = utils.Class.extend({
	_model: null,
	_modelName: null,
	_modelSchema: null,
	_repository: null,
	_logger: null,
	_conditions: null,
	_findOptions: null,
	_orm: null,

	init: function (orm, modelName) {
		utils.assert('`orm` is a required field!', orm !== undefined);
		utils.assert('`modelName` is a required field!', modelName !== undefined);

		this._model = orm._models[modelName];
		this._modelName = modelName;
		this._modelSchema = orm.getSchema().getModel(modelName);
		this._repository = orm._repository;
		this._logger = orm._logger;
		this._orm = orm;
		this._conditions = [];
		this._findOptions = {};
	},

	where: function (field) {
		return new Where(this, this._modelSchema.getProperty(field));
	},

	limit: function (number) {
		this._findOptions.limit = number;

		return this;
	},

	offset: function (number) {
		this._findOptions.offset = number;

		return this;
	},

	orderBy: function (field, direction) {
		direction = direction || 'ascending';

		this._findOptions.orderBy = this._modelSchema.getProperty(field).getOriginalName();
		this._findOptions.direction = direction;

		return this;
	},

	create: function (data) {
		return utils.instantiateModel(this._orm, this._model, data, true);
	},

	find: function (id) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			if (id !== undefined) {
				if (_.isObject(id)) {
					_.each(id, function (value, key) {
						self.where(key).isEqual(value);
					});
				}
				else {
					self.where(self._modelSchema.getPrimaryKey()[0].getName()).isEqual(id);
				}
			}

			self.limit(1);

			self._repository.find(self._modelSchema, self._findOptions, self._conditions).then(function (result) {
				if (result.length === 0)
					return resolve(null);

				var model = utils.instantiateModel(self._orm, self._model, self._modelSchema.translateObjectToOrm(result[0]));

				return resolve(model);
			}, reject);
		});
	},

	findAll: function () {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			var query = self._repository.find(self._modelSchema, self._findOptions, self._conditions);

			query.then(function (result) {
				var items = [];

				_.each(result, function (data) {
					try {
						var model = utils.instantiateModel(self._orm, self._model, self._modelSchema.translateObjectToOrm(data));

						items.push(model);
					}
					catch (err) {
						reject(err);
					}
				});

				return resolve(items);
			}, reject);
		});
	},

	getClass: function () {
		return this._model;
	}
});

module.exports = Factory;
},{"./../utils":24,"./where":8,"rsvp":"rsvp","underscore":"underscore"}],6:[function(require,module,exports){
var RSVP = require('rsvp'),
	_ = require('underscore'),
	ORM = require('./orm'),
	repositories = require('../repositories');

// Base API object. Contains the pass-thrus for other parts of the orm
var api = {};

api.create = function create(repository, loggerModule) {
	return new RSVP.Promise(function (resolve, reject) {
		var orm = new ORM(repository, loggerModule);

		orm.ready().then(resolve, reject);
	});
};

api.ready = function ready(ormHash) {
	return new RSVP.Promise(function (resolve, reject) {
		var promiseArray = [];

		_.each(ormHash, function (promise) {
			promiseArray.push(promise);
		});

		RSVP.all(promiseArray).then(function () {
			// Resolve with the original model since the promises are all complete
			resolve(ormHash);
		}, reject);
	});
};

module.exports = api;
},{"../repositories":11,"./orm":7,"rsvp":"rsvp","underscore":"underscore"}],7:[function(require,module,exports){
var RSVP = require('rsvp'),
	_ = require('underscore'),
	utils = require('./../utils'),
	BaseModel= require('./basemodel'),
	Factory = require('./factory');

// ID counter to keep track of the next ID to be used when a model is instantiated
var nextId = 0;

var ORM = utils.Class.extend({
	/**
	 * Instance of the repository the ORM will use to retrieve data
	 * @member {Repository}
	 */
	_repository: null,

	/**
	 * Array of decorator objects used to decorate all models instantiated via the ORM.
	 * @member {Array}
	 */
	_decorations: null,

	/**
	 * Logger module used with the ORM. Should follow the console object's contract.
	 * @member {Object}
	 */
	_logger: null,

	/**
	 * Object that contains all the classes for the models.
	 * @member {Object}
	 */
	_classes: null,

	/**
	 * The schema object that the ORM uses to build the classes and talk to the repository.
	 * @member {Schema}
	 */
	_schema: null,

	/**
	 * The promise that is issued from parsing the schema from the repository. Used to track whether or not the ORM is
	 * ready to use yet.
	 * @member {RSVP.Promise}
	 */
	_readyPromise: null,

	/**
	 * Container of events that are mapped to all ORM models.
	 * @member {Object}
	 */
	_globalEvents: null,

	/**
	 * Constructor for the ORM Class.
	 *
	 * @param repository
	 * @param loggerModule
	 */
	init: function (repository, loggerModule) {
		utils.assert('You must supply a repository to use the ORM!', repository !== undefined);

		this._repository = repository;
		this._logger = loggerModule || console;
		this._models = {};
		this._decorations = [];
		this._globalEvents = {};

		parseRepositorySchema(this);
	},

	ready: function () {
		return this._readyPromise;
	},

	factory: function (modelName) {
		utils.assert('Could not find the model `'+modelName+'`!', this._models[modelName] !== undefined);

		return new Factory(this, modelName);
	},

	/**
	 * Extends the classes that the ORM instantiates from the models. If overriding an existing method, the method's
	 * interface should match the original and should call this._super() so that existing contracts aren't broken and
	 * all base functionality is run. Failure to do this might break the ORM.
	 *
	 * @param {string} modelName Name of the model being extended
	 * @param {object} object Object of methods and properties that will extend the model
	 */
	extend: function (modelName, object) {
		var model = this._models[modelName];

		this._models[modelName] = model.extend(object);
	},

	decorate: function (decorator) {
		this._decorations.push(decorator);
	},

	getDecorations: function () {
		return this._decorations;
	},

	getSchema: function () {
		return this._schema;
	},

	getRepository: function () {
		return this._repository;
	},

	getClass: function (modelName) {
		return this._models[modelName];
	},

	/**
	 * Simple event registration.
	 * @param event
	 * @param callback
	 */
	registerGlobalEvent: function (event, callback) {
		utils.assert("Callback must be a function!", _.isFunction(callback));

		// Setup the event container
		if (this._globalEvents[event] === undefined)
			this._globalEvents[event] = [];

		// Store the event handler
		this._globalEvents[event].push(callback);
	},

	getEventHandlers: function (eventName) {
		return this._globalEvents[eventName];
	}
});

module.exports = ORM;


/**
 *       PRIVATE FUNCTIONS
 */

function parseRepositorySchema(orm) {
	orm._readyPromise = new RSVP.Promise(function (resolve, reject) {
		orm._repository.getSchema().then(function (schema) {
			orm._schema = schema;

			_.each(schema.getModels(), function (model) {
				orm._models[model.getName()] = generateModel(orm, model);
			});

			resolve(orm);
		}, reject);
	});
}

function generateModel(orm, model) {
	return BaseModel.extend({
		_orm: orm,
		_repository: orm._repository,
		_model: model,
		_logger: orm._logger,
		
		init: function (data, isNew) {
			// Set the instance ID for tracking
			this.setup(nextId, data, isNew);

			// Trigger the init event
			this.trigger('init');

			// Bump the next id
			nextId++;
		}
	});
}
},{"./../utils":24,"./basemodel":4,"./factory":5,"rsvp":"rsvp","underscore":"underscore"}],8:[function(require,module,exports){
var utils = require('./../utils'),
	RSVP = require('rsvp'),
	_ = require('underscore');

var Where = utils.Class.extend({
	_factory: null,
	_field: null,
	_repository: null,

	init: function (factory, property) {
		utils.assert('Factory must be provided!', factory !== undefined);
		utils.assert('Property must be provided!', property !== undefined);

		this._factory = factory;
		this._field = property.getOriginalName();
		this._repository = this._factory._repository;
	},

	isEqual: function (value) {
		this._factory._conditions.push(new this._repository.where.isEqual(this._field, value));

		return this._factory;
	},

	isNotEqual: function (value) {
		this._factory._conditions.push(new this._repository.where.isNotEqual(this._field, value));

		return this._factory;
	},

	isBetween: function (a, b) {
		this._factory._conditions.push(new this._repository.where.isBetween(this._field, [a,b]));

		return this._factory;
	},

	isGreaterThan: function (value) {
		this._factory._conditions.push(new this._repository.where.isGreaterThan(this._field, value));

		return this._factory;
	},

	isGreaterThanOrEqual: function (value) {
		this._factory._conditions.push(new this._repository.where.isGreaterThanOrEqual(this._field, value));

		return this._factory;
	},

	isLessThan: function (value) {
		this._factory._conditions.push(new this._repository.where.isLessThan(this._field, value));

		return this._factory;
	},

	isLessThanOrEqual: function (value) {
		this._factory._conditions.push(new this._repository.where.isLessThanOrEqual(this._field, value));

		return this._factory;
	},

	isNull: function () {
		this._factory._conditions.push(new this._repository.where.isNull(this._field));

		return this._factory;
	},

	isNotNull: function () {
		this._factory._conditions.push(new this._repository.where.isNotNull(this._field));

		return this._factory;
	}
});

module.exports = Where;
},{"./../utils":24,"rsvp":"rsvp","underscore":"underscore"}],9:[function(require,module,exports){
var RSVP = require('rsvp'),
	utils = require('./../../utils'),
	_ = require('underscore');

var AbstractRepository = utils.Class.extend({
	_options: null,
	_logger: null,

	// Include the where functions
	where: null,

	
	init: function (options, loggerModule, driverModule) {
		throw new utils.Exceptions.AbstractClassException();
	},

	// Should return a promise interface
	getSchema: function () {},
	
	// Should return a promise interface
	find: function (model, options, conditions) {},

	// Should return a promise interface
	create: function (model, data) {},

	// Should return a promise interface
	save: function (model, data, primaryKey) {},

	// Should return a promise interface
	delete: function (model, primaryKey) {},

	reload: function (model, data) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			var conditions = [];

			// Build the where
			_.each(model.getPrimaryKey(), function (value) {
				conditions.push(new self.where.isEqual(value.getOriginalName(), data[value.getOriginalName()]));
			});

			self.find(model, {limit: 1}, conditions).then(function (newData) {
				return resolve(newData[0]);
			}, reject);
		});
	},

	_validateFields: function (model, obj) {
		_.each(model.getProperties(), function (property) {
			if (property.isRequired())
				if ( ! _.has(obj, property.getOriginalName()) || obj[property.getOriginalName()] === null)
					throw new utils.Exceptions.ValidationException('Object missing required field `'+property.getName()+'`!');
		});
	}
});

// Export the class
module.exports = AbstractRepository;
},{"./../../utils":24,"rsvp":"rsvp","underscore":"underscore"}],10:[function(require,module,exports){
var utils = require('./../../utils');

var AbstractCondition = utils.Class.extend({
	field: null,
	value: null,

	init: function (field, value) {
		throw new utils.Exceptions.AbstractClassException();
	}
});

module.exports = {

	isEqual: AbstractCondition.extend(),

	isNotEqual: AbstractCondition.extend(),

	isBetween: AbstractCondition.extend(),

	isGreaterThan: AbstractCondition.extend(),

	isGreaterThanOrEqual: AbstractCondition.extend(),

	isLessThan: AbstractCondition.extend(),

	isLessThanOrEqual: AbstractCondition.extend(),

	isNull: AbstractCondition.extend(),

	isNotNull: AbstractCondition.extend()
};
},{"./../../utils":24}],11:[function(require,module,exports){
module.exports = {
	abstract: require('./abstract/repository'),
	mysql: require('./mysql'),
	rest: require('./rest')
};
},{"./abstract/repository":9,"./mysql":25,"./rest":15}],12:[function(require,module,exports){
// Get dependencies
var RSVP = require('rsvp'),
	_ = require('underscore'),
	utils = require('./../../../utils'),
	Response = require('./response');

/**
 * Requires jQuery
 */
var RestJqueryDriver = utils.Class.extend({
	logger: null,
	baseUrl: null,

	init: function (options, loggerModule) {
		// Validate the input
		utils.assert('`options` must be an object!', _.isObject(options));
		utils.assert('Options must have a baseUrl string!', _.isString(options.baseUrl));

		this.baseUrl = options.baseUrl;

		// Bring in the logger
		this.logger = loggerModule || console;
	},

	get: function (url, headers) {
		var self = this;
		headers = headers || {};

		return new RSVP.Promise(function (resolve, reject) {
			jQuery.ajax({
				url: self.baseUrl+url,
				type: 'GET',
				headers: headers,
			}).then(function (data, status, xhr) {
				resolve(new Response(data, xhr.status, this.logger));
			}, function (xhr, status, error) {
				reject(error);
			});
		});
	},

	post: function (url, body, headers) {
		var self = this;
		headers = headers || {};
		
		return new RSVP.Promise(function (resolve, reject) {
			jQuery.ajax({
				url: self.baseUrl+url,
				type: 'POST',
				headers: headers,
				data: body,
			}).then(function (data, status, xhr) {
				resolve(new Response(data, xhr.status, this.logger));
			}, function (xhr, status, error) {
				reject(error);
			});
		});
	},

	put: function (url, body, headers) {
		var self = this;
		headers = headers || {};
		
		return new RSVP.Promise(function (resolve, reject) {
			jQuery.ajax({
				url: self.baseUrl+url,
				type: 'PUT',
				headers: headers,
				data: body,
			}).then(function (data, status, xhr) {
				resolve(new Response(data, xhr.status, this.logger));
			}, function (xhr, status, error) {
				reject(error);
			});
		});
	},

	delete: function (url, headers) {
		var self = this;
		headers = headers || {};
		
		return new RSVP.Promise(function (resolve, reject) {
			jQuery.ajax({
				url: self.baseUrl+url,
				type: 'DELETE',
				headers: headers
			}).then(function (data, status, xhr) {
				resolve(new Response(null, xhr.status, this.logger));
			}, function (xhr, status, error) {
				reject(error);
			});
		});
	}
});

module.exports = RestJqueryDriver;
},{"./../../../utils":24,"./response":14,"rsvp":"rsvp","underscore":"underscore"}],13:[function(require,module,exports){
// Get dependencies
var RSVP = require('rsvp'),
	_ = require('underscore'),
	utils = require('./../../../utils'),
	request = require('request'),
	Response = require('./response');

var RestNodeDriver = utils.Class.extend({
	logger: null,
	baseUrl: null,

	init: function (options, loggerModule) {
		// Validate the input
		utils.assert('`options` must be an object!', _.isObject(options));
		utils.assert('Options must have a baseUrl string!', _.isString(options.baseUrl));

		this.baseUrl = options.baseUrl;

		// Bring in the logger
		this.logger = loggerModule || console;
	},

	get: function (url, headers) {
		var self = this;
		headers = headers || {};
		
		return new RSVP.Promise(function (resolve, reject) {
			request({
				url: self.baseUrl+url,
				headers: headers,
				method: 'GET'
			}, function (err, response, body) {
				if (err)
					reject(err);

				resolve(new Response(JSON.parse(body), response.statusCode, this.logger));
			});
		});
	},

	post: function (url, body, headers) {
		var self = this;
		headers = headers || {};
		
		return new RSVP.Promise(function (resolve, reject) {
			request({
				url: self.baseUrl+url,
				headers: headers,
				method: 'POST',
				json: body,
			}, function (err, response, body) {
				if (err)
					reject(err);

				resolve(new Response(body, response.statusCode, this.logger));
			});
		});
	},

	put: function (url, body, headers) {
		var self = this;
		headers = headers || {};
		
		return new RSVP.Promise(function (resolve, reject) {
			request({
				url: self.baseUrl+url,
				headers: headers,
				method: 'PUT',
				json: body,
			}, function (err, response, body) {
				if (err)
					reject(err);

				resolve(new Response(body, response.statusCode, this.logger));
			});
		});
	},

	delete: function (url, headers) {
		var self = this;
		headers = headers || {};
		
		return new RSVP.Promise(function (resolve, reject) {
			request({
				url: self.baseUrl+url,
				headers: headers,
				method: 'DELETE'
			}, function (err, response, body) {
				if (err)
					reject(err);

				resolve(new Response(body, response.statusCode, this.logger));
			});
		});
	},
});

module.exports = RestNodeDriver;
},{"./../../../utils":24,"./response":14,"request":25,"rsvp":"rsvp","underscore":"underscore"}],14:[function(require,module,exports){
// Get dependencies
var utils = require('./../../../utils');

var ResponseObject = utils.Class.extend({
	data: null,
	statusCode: null,
	logger: null,

	init: function (data, statusCode, loggerModule) {
		// Validate the input
		utils.assert('`data` is a required field!', data !== undefined);
		utils.assert('`statusCode` is a required field!', statusCode !== undefined);

		this.data = data;
		this.statusCode = statusCode;

		// Bring in the logger
		this.logger = loggerModule || console;
	}
});

module.exports = ResponseObject;
},{"./../../../utils":24}],15:[function(require,module,exports){
var _ = require('underscore'),
	RSVP = require('rsvp'),
	AbstractRepository = require('./../abstract/repository'),
	utils = require('./../../utils'),
	Schema = require('./../../schema');

var REST = AbstractRepository.extend({
	// Include the where functions
	where: null,
	_schemaPromise: null,
	_driver: null,

	init: function (driverModule, loggerModule) {
		utils.assert("A driver must be provided!", driverModule !== undefined);
		this._logger = loggerModule || console;

		this._driver = driverModule;
		this.where = require('./where');
	},

	getSchema: function () {
		var self = this;

		// Only get the schema once
		if (this._schemaPromise)
			return this._schemaPromise;

		this._schemaPromise = new RSVP.Promise(function (resolve, reject) {
			self._driver.get('/schema').then(function (response) {
				var schema = new Schema.Schema();
				
				// Parse the schema
				_.each(response.data, function (model) {
					var modelSchema = new Schema.Model(model.name);

					_.each(model.properties, function (property) {
						var propertySchema = new Schema.Property(property.name, property.type);

						if (property.primaryKey)
							propertySchema.makePrimaryKey();

						if (property.required)
							propertySchema.makeRequired();

						modelSchema.addProperty(propertySchema);
					});

					schema.addModel(modelSchema);
				});

				resolve(schema);
			}, reject);
		});
		
		return this._schemaPromise;
	},
	
	find: function (model, options, conditions) {
		var self = this;

		options = options || {};

		return new RSVP.Promise(function (resolve, reject) {
			var url = '/api/'+model.getOriginalName(),
				pk = null;

			_.each(conditions, function (condition, index) {
				if (model.getProperty(condition.field).isPrimaryKey() && condition instanceof self.where.isEqual)
					pk = condition.value;
			});

			if (pk !== null) {
				// No need to do all the other stuff
				url+= '/'+pk;

				self._driver.get(url).then(function (response) {
					if (response.statusCode !== 200)
						return resolve([]);

					return resolve([response.data]);
				}, reject);
			}
			else {
				var defaults = {
					limit: null,
					offset: null,
					orderBy: null,
					direction: null,
					from: model.getOriginalName(),
					where: conditions
				};

				url+= buildUrl(_.extend({}, defaults, options));

				self._driver.get(url).then(function (response) {
					if (response.statusCode !== 200)
						return resolve([]);
					
					resolve(response.data._embedded[model.getOriginalName()]);
				}, reject);
			}
		});
	},

	create: function (model, data) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			self._validateFields(model, data);

			var dataKeys = _.keys(data),
				rawData = {},
				url = '/api/'+model.getOriginalName();

			_.each(dataKeys, function (key) {
				if (model.getProperty(key))
					rawData[model.getProperty(key).getOriginalName()] = data[key];
			});

			self._driver.post(url, rawData).then(function (result) {
				var conditions = [];

				_.each(model.getPrimaryKey(), function (value) {
					if (value.getOriginalName() === 'id' && _.isEmpty(data[value.getOriginalName()]))
						conditions.push(new self.where.isEqual(value.getOriginalName(), result.data.id));

					else
						conditions.push(new self.where.isEqual(value.getOriginalName(), data[value.getOriginalName()]));
				});

				self.find(model, {}, conditions).then(function (newData) {
					return resolve(newData[0]);
				}, reject);
			}, reject);
		});
	},

	save: function (model, originalData, data) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			var dataKeys = _.keys(data),
				columns = {},
				url = '/api/'+model.getOriginalName()+'/',
				pk = null,
				conditions = [];

			// Build the where
			_.each(model.getPrimaryKey(), function (value) {
				pk = originalData[value.getOriginalName()];
				conditions.push(new self.where.isEqual(value.getOriginalName(), data[value.getOriginalName()]));
			});

			url+= pk;

			_.each(dataKeys, function (key) {
				if (model.getProperty(key))
					columns[model.getProperty(key).getOriginalName()] = data[key];
			});

			self._driver.put(url, columns).then(function (result) {
				self.find(model, {limit: 1}, conditions).then(function (newData) {
					return resolve(newData[0]);
				}, reject);
			}, reject);
		});
	},

	delete: function (model, data) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			var url = "/api/"+model.getOriginalName(),
				conditions = [];

			// Build the where
			_.each(model.getPrimaryKey(), function (value) {
				url+= '/'+data[value.getOriginalName()];
			});

			self._driver.delete(url).then(function (result) {
				resolve(result.data);
			}, reject);
		});
	}
});

// Attach the drivers
REST.Drivers = {
	jQuery: require('./driver/jquery'),
	Node: require('./driver/node'),
	Mock: require('./driver/mock')
};

// Export the class
module.exports = REST;


/**
 *       PRIVATE FUNCTIONS
 */


function buildUrl(queryObj) {
	var baseQuery = {
			from: null,
			where: null,
			limit: null,
			offset: null,
			orderBy: null,
			direction: null
		},
		query = _.extend({}, baseQuery, queryObj),
		url = parseWhereToQueryString(query.where);

	if (query.orderBy) {
		url+='&_order='+query.orderBy;
		if (query.direction)
			url+=':'+query.direction;
	}

	if (query.limit)
		url+='&_limit='+query.limit;

	if (query.offset)
		url+='&_offset='+query.offset;

	if (url.length === 0)
		return '';

	return '?'+url;
}

function parseWhereToQueryString (whereArray) {
	var where = [];

	if (whereArray === undefined || whereArray.length === 0)
		return '';

	_.each(whereArray, function (value) {
		where.push(value.toQuery());
	});

	return where.join('&');
}
},{"./../../schema":18,"./../../utils":24,"./../abstract/repository":9,"./driver/jquery":12,"./driver/mock":undefined,"./driver/node":13,"./where":16,"rsvp":"rsvp","underscore":"underscore"}],16:[function(require,module,exports){
var AbstractWhere = require('./../abstract/where'),
	utils = require('./../../utils'),
	_ = require('underscore');

var classes = {};

classes.isEqual = AbstractWhere.isEqual.extend({
	init: function (field, value) {
		this.field = field;
		this.value = value;
	},

	toQuery: function () {
		return this.field+'='+this.value;
	}
});

classes.isNotEqual = AbstractWhere.isNotEqual.extend({
	init: function (field, value) {
		this.field = field;
		this.value = value;
	},

	toQuery: function () {
		return this.field+'=<>'+this.value;
	}
});

classes.isBetween = AbstractWhere.isBetween.extend({
	init: function (field, value) {
		this.field = field;
		this.value = value;

		utils.assert('Value must be an array with only two items', _.isArray(value) && value.length === 2);
	},

	toQuery: function () {
		return this.field+'='+this.value[0]+'|'+this.value[1];
	}
});

classes.isGreaterThan = AbstractWhere.isGreaterThan.extend({
	init: function (field, value) {
		this.field = field;
		this.value = value;
	},

	toQuery: function () {
		return this.field+'=>'+this.value;
	}
});

classes.isGreaterThanOrEqual = AbstractWhere.isGreaterThanOrEqual.extend({
	init: function (field, value) {
		this.field = field;
		this.value = value;
	},

	toQuery: function () {
		return this.field+'=>='+this.value;
	}
});

classes.isLessThan = AbstractWhere.isLessThan.extend({
	init: function (field, value) {
		this.field = field;
		this.value = value;
	},

	toQuery: function () {
		return this.field+'=<'+this.value;
	}
});

classes.isLessThanOrEqual = AbstractWhere.isLessThanOrEqual.extend({
	init: function (field, value) {
		this.field = field;
		this.value = value;
	},

	toQuery: function () {
		return this.field+'=<='+this.value;
	}
});

classes.isNull = AbstractWhere.isNull.extend({
	init: function (field) {
		this.field = field;
	},

	toQuery: function () {
		return this.field+'=:NULL:';
	}
});

classes.isNotNull = AbstractWhere.isNotNull.extend({
	init: function (field) {
		this.field = field;
	},

	toQuery: function () {
		return this.field+'=<>:NULL:';
	}
});

module.exports = classes;
},{"./../../utils":24,"./../abstract/where":10,"underscore":"underscore"}],17:[function(require,module,exports){
var utils = require('./../utils'),
	_ = require('underscore');

module.exports = utils.Class.extend({
	_name: null,
	_originalName: null,

	init: function () {
		// We don't actually want to instantiate this object, as it is abstract.
		throw new utils.Exceptions.AbstractClassException();
	},

	getName: function () {
		return this._name;
	},

	getOriginalName: function () {
		return this._originalName;
	}
});
},{"./../utils":24,"underscore":"underscore"}],18:[function(require,module,exports){
module.exports = {
	Abstract: require('./abstract'),
	Schema: require('./schema'),
	Model: require('./model'),
	Property: require('./property')
};
},{"./abstract":17,"./model":19,"./property":20,"./schema":21}],19:[function(require,module,exports){
var utils = require('./../utils'),
	_ = require('underscore'),
	AbstractSchema = require('./abstract'),
	Property = require('./property'),
	inflection = require('inflection');
	
module.exports = AbstractSchema.extend({
	_properties: null,

	init: function (name, metadata) {
		// Set the name of the object
		this._setName(name);

		// Store the metadata
		this._metadata = metadata || {};

		this._properties = {};
	},

	addProperty: function (property) {
		utils.assert('`property` must be an instance of Schema.Property', property instanceof Property);
		utils.assert('Property must not already be defined in the model', this._properties[property.getName()] === undefined);
		this._properties[property.getName()] = property;

		return this;
	},

	getProperty: function (name) {
		return this._properties[utils.normalizeName(name, false)];
	},

	getProperties: function () {
		return this._properties;
	},

	getPrimaryKey: function () {
		var keys = [];

		for (var key in this._properties) {
			if (this._properties[key].isPrimaryKey())
				keys.push(this._properties[key]);
		}

		return keys;
	},

	getPropertyNames: function () {
		var names = [];

		for (var key in this._properties) {
			names.push(this._properties[key].getName());
		}

		return names;
	},

	getPluralizedName: function () {
		var parts = inflection.underscore(this.getName()).split('_');

		if (parts.length === 1)
			parts[0] = inflection.pluralize(parts[0]);
		else
			parts[parts.length - 1] = inflection.pluralize(parts[parts.length - 1]);

		return inflection.camelize(parts.join('_'), true);
	},


	getPOJO: function () {
		var schema = {
			name: this.getName(),
			properties: {}
		};

		_.each(this.getProperties(), function (property) {
			schema.properties[property.getName()] = property.getPOJO();
		});

		return schema;
	},

	/**
	 * Translates an object from the repository to one that the ORM can use
	 * @param data
	 * @returns {{}}
	 */
	translateObjectToOrm: function (data) {
		var newObj = {},
			self = this;

		_.each(data, function (value, key) {
			var prop = self.getProperty(key);

			if (prop === undefined)
				return;

			newObj[prop.getName()] = value;
		});

		return newObj;
	},

	/**
	 * Translates an object from the ORM to one the repository can understand
	 * @param data
	 * @returns {{}}
	 */
	translateObjectToRepository: function (data) {
		var newObj = {},
			self = this;

		_.each(data, function (value, key) {
			var prop = self.getProperty(key);

			if (prop === undefined)
				return;

			newObj[prop.getOriginalName()] = value;
		});

		return newObj;
	},

	_setName: function (name) {
		utils.assert('`name` is a required field!', name !== undefined);
		utils.assert('`name` must be a string!', _.isString(name));

		this._name = utils.normalizeName(name);
		this._originalName = name;
	}
});
},{"./../utils":24,"./abstract":17,"./property":20,"inflection":26,"underscore":"underscore"}],20:[function(require,module,exports){
var utils = require('./../utils'),
	AbstractSchema = require('./abstract'),
	_ = require('underscore');

module.exports = AbstractSchema.extend({
	_primaryKey: false,
	_required: false,
	_type: "String",
	_metadata: null,

	init: function (name, type, metadata) {
		// Set the name of the object
		this._setName(name);
		this._type = type || this._type;

		// Store the metadata
		this._metadata = metadata || {};
	},

	makePrimaryKey: function () {
		this._primaryKey = true;
	},

	isPrimaryKey: function () {
		return this._primaryKey;
	},

	makeRequired: function () {
		this._required = true;
	},

	isRequired: function () {
		return this._required;
	},

	getType: function () {
		return this._type;
	},

	getPOJO: function () {
		return {
			name: this.getName(),
			type: this.getType(),
			primaryKey: this.isPrimaryKey(),
			required: this.isRequired()
		};
	},

	getMetadata: function () {
		return this._metadata;
	},

	_setName: function (name) {
		utils.assert('`name` is a required field!', name !== undefined);
		utils.assert('`name` must be a string!', _.isString(name));

		this._name = utils.normalizeName(name, false);
		this._originalName = name;
	}
});
},{"./../utils":24,"./abstract":17,"underscore":"underscore"}],21:[function(require,module,exports){
var utils = require('./../utils'),
	_ = require('underscore'),
	SchemaModel = require('./model');

module.exports = utils.Class.extend({
	_models: null,

	init: function () {
		this._models = {};
	},

	addModel: function (model) {
		utils.assert('`model` must be an instance of Schema.Model', model instanceof SchemaModel);
		utils.assert('Model must not already be defined in the schema', this._models[model.getName()] === undefined);

		this._models[model.getName()] = model;

		return this;
	},

	getModel: function (name) {
		// Normalize the name so that it works from either direction
		return this._models[utils.normalizeName(name)];
	},

	getModels: function () {
		return this._models;
	},

	getModelNames: function () {
		var names = [];

		_.each(this._models, function (value) {
			names.push(value.getName());
		});

		return names;
	},

	getPOJO: function () {
		var schema = {};

		_.each(this.getModels(), function (model) {
			schema[model.getName()] = model.getPOJO();
		});

		return schema;
	}
});
},{"./../utils":24,"./model":19,"underscore":"underscore"}],22:[function(require,module,exports){
/* Simple JavaScript Inheritance
 * By John Resig http://ejohn.org/
 * MIT Licensed.
 */
// Inspired by base2 and Prototype
var initializing = false, 
    fnTest = /xyz/.test(function(){xyz;}) ? /\b_super\b/ : /.*/;
    
// The base Class implementation (does nothing)
Class = function() {};

// Create a new Class that inherits from this class
Class.extend = function(prop) {
    var _super = this.prototype;
    
    // Instantiate a base class (but only create the instance,
    // don't run the init constructor)
    initializing = true;
    var prototype = new this();
    initializing = false;
    
    // Copy the properties over onto the new prototype
    for (var name in prop) {
        // Check if we're overwriting an existing function
        prototype[name] = typeof prop[name] == "function" &&
            typeof _super[name] == "function" && fnTest.test(prop[name]) ?
            (function(name, fn){
                return function() {
                    var tmp = this._super;
                   
                    // Add a new ._super() method that is the same method
                    // but on the super-class
                    this._super = _super[name];
                   
                    // The method only need to be bound temporarily, so we
                    // remove it when we're done executing
                    var ret = fn.apply(this, arguments);
                    this._super = tmp;
                   
                    return ret;
                };
            })(name, prop[name]) :
            prop[name];
    }
    
    // The dummy class constructor
    Class = function () {
        // All construction is actually done in the init method
        if ( !initializing && this.init )
            this.init.apply(this, arguments);
    };
    
    // Populate our constructed prototype object
    Class.prototype = prototype;
    
    // Enforce the constructor to be what we expect
    Class.constructor = Class;
    
    // And make this class extendable
    Class.extend = arguments.callee;
    
    return Class;
};

if(!(typeof exports === 'undefined')) {
    exports.Class = Class;
}
},{}],23:[function(require,module,exports){
var AssertionException = function (message, constructor) {
	Error.captureStackTrace(this, constructor || this);
	this.message = message || 'An assertion made did not pass!';
};

inherits(AssertionException, Error);
AssertionException.prototype.name = 'AssertionException';

var ValidationException = function (message, constructor) {
	Error.captureStackTrace(this, constructor || this);
	this.message = message || 'Object did not pass validation!';
};

inherits(ValidationException, Error);
ValidationException.prototype.name = 'ValidationException';

var AbstractClassException = function (message, constructor) {
	Error.captureStackTrace(this, constructor || this);
	this.message = message || 'This class is abstract and cannot be instantiated!';
};

inherits(AbstractClassException, Error);
AbstractClassException.prototype.name = 'AbstractClassException';

var DeletedModelException = function (message, constructor) {
	Error.captureStackTrace(this, constructor || this);
	this.message = message || 'Deleted object access is not allowed!';
};

inherits(DeletedModelException, Error);
DeletedModelException.prototype.name = 'DeletedModelException';

var UnsavedModelException = function (message, constructor) {
	Error.captureStackTrace(this, constructor || this);
	this.message = message || "Model must be saved first!";
};

inherits(UnsavedModelException, Error);
UnsavedModelException.prototype.name = 'UnsavedModelException';

var ModelInstantiationException = function (message, constructor) {
	Error.captureStackTrace(this, constructor || this);
	this.message = message || "There was an error instantiating your model!";
};

inherits(ModelInstantiationException, Error);
ModelInstantiationException.prototype.name = 'ModelInstantiationException';

var RepositoryException = function (message, constructor) {
	Error.captureStackTrace(this, constructor || this);
	this.message = message || "There was an error in the repository!";
};

inherits(RepositoryException, Error);
RepositoryException.prototype.name = 'RepositoryException';

module.exports = {
	AssertionException: AssertionException,
	ValidationException: ValidationException,
	AbstractClassException: AbstractClassException,
	DeletedModelException: DeletedModelException,
	UnsavedModelException: UnsavedModelException,
	ModelInstantiationException: ModelInstantiationException,
	RepositoryException: RepositoryException
};


// Extract the util.inherits code so we don't pull half of node with us when we browserify
function inherits (ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
}
},{}],24:[function(require,module,exports){
var api = {},
	Exceptions = require('./exceptions'),
	inflection = require('inflection'),
	_ = require('underscore');

module.exports = api;

/**
 * Asserts that the condition passed is true.
 * @param message
 * @param condition
 */
api.assert = function assert (message, condition) {
	if (condition !== true)
		throw new Exceptions.AssertionException(message);
};

api.Class = require('./class').Class;

api.Exceptions = Exceptions;

/**
 * Helper for currying a function.
 *
 * ### Usage
 *
 * ```javascript
 * // Some function you want to partially apply
 * function someFunc(a, b, c, d) {return arguments;}
 *
 * // Curry the function
 * var curriedFunc = curry(someFunc, null, 'a', 'b');
 *
 * // Returns `['a', 'b', 'c', 'd']`
 * curriedFunc('c', 'd');
 * ```
 * 
 * @param  {Function} fn        Function to be curried
 * @param  {mixed}   context    Context the function will be called in
 * @param  {...number} var_args Arguments to partially apply to the function to be called
 * @return {function}           Function with partially applied arguments
 */
api.curry = function (fn, context) {
	// Container for the arguments to call the function with
	var baseArgs = [];

	// Get the arguments to be partially applied
	for (var i = 2, l = arguments.length; i < l; i++) {
		baseArgs.push(arguments[i]);
	}

	// Return a wrapper function
	return function () {
		var args = baseArgs.slice(0);
		// Get the args to call the function with and add them to the args array
		for (var i = 0, l = arguments.length; i < l; i++) {
			args.push(arguments[i]);
		}

		// Call the function with the provided context and arguments
		return fn.apply(context, args);
	};
};

api.normalizeName = function normalizeName (name, singularize) {
	// Set defaults
	if (singularize === undefined)
		singularize = true;

	api.assert("Name must be a string", _.isString(name));

	// Clean up the name and split it up into parts
	var parts = name.replace(/(\s|\_)+/g, ' ').trim().split(' '),
		newName, word;

	// Singularize it if necessary
	if (singularize) {
		if (parts.length === 1) {
			// There's only one word in the name
			parts[0] = inflection.singularize(parts[0]);
		}

		else {
			// Only singularize the last word
			word = parts.pop();

			parts.push(inflection.singularize(word));
		}
	}

	// Recombine
	newName = parts.join('_');

	// Camelize and return
	return inflection.camelize(inflection.underscore(newName), true);
};

/**
 * Overrides the model's method with a new method that has access to original methods
 * @param model
 * @param name
 * @param method
 */
api.overrideMethod = function overrideMethod (model, name, method) {
	var originalMethod = model[name] || api.noop,
		newMethod = function () {
			var returnVal;

			// Store the _super() method to revert things back to as they were
			var tmp = model._super;

			model._super = originalMethod;

			// Fire off the method with the proper context
			returnVal = method.apply(model, arguments);

			model._super = tmp;

			return returnVal;
		};

	model[name] = newMethod;
};

api.decorateObject = function decorateObject (obj, decorations) {
	// Apply the decorations
	_.each(decorations, function (decoration) {
		// Override the methods
		_.each(decoration, function (method, name) {
			api.assert("Decorator method must be a function!", _.isFunction(method));
			api.overrideMethod(obj, name, method);
		});
	});

	return obj;
};

api.instantiateModel = function instantiateModel (orm, model, data, isNew) {
	var obj = new model(data, isNew),
		decorations = orm.getDecorations();

	api.decorateObject(obj, decorations);

	return obj;
};

api.noop = function noop () {
	/* NOOP */
};
},{"./class":22,"./exceptions":23,"inflection":26,"underscore":"underscore"}],25:[function(require,module,exports){

},{}],26:[function(require,module,exports){
/*!
 * inflection
 * Copyright(c) 2011 Ben Lin <ben@dreamerslab.com>
 * MIT Licensed
 *
 * @fileoverview
 * A port of inflection-js to node.js module.
 */

( function ( root, factory ){
  if( typeof define === 'function' && define.amd ){
    define([], factory );
  }else if( typeof exports === 'object' ){
    module.exports = factory();
  }else{
    root.inflection = factory();
  }
}( this, function (){

  /**
   * @description This is a list of nouns that use the same form for both singular and plural.
   *              This list should remain entirely in lower case to correctly match Strings.
   * @private
   */
  var uncountable_words = [
    // 'access',
    'accommodation',
    'adulthood',
    'advertising',
    'advice',
    'aggression',
    'aid',
    'air',
    'aircraft',
    'alcohol',
    'anger',
    'applause',
    'arithmetic',
    // 'art',
    'assistance',
    'athletics',
    // 'attention',

    'bacon',
    'baggage',
    // 'ballet',
    // 'beauty',
    'beef',
    // 'beer',
    // 'behavior',
    'biology',
    // 'billiards',
    'blood',
    'botany',
    // 'bowels',
    'bread',
    // 'business',
    'butter',

    'carbon',
    'cardboard',
    'cash',
    'chalk',
    'chaos',
    'chess',
    'crossroads',
    'countryside',

    // 'damage',
    'dancing',
    // 'danger',
    'deer',
    // 'delight',
    // 'dessert',
    'dignity',
    'dirt',
    // 'distribution',
    'dust',

    'economics',
    'education',
    'electricity',
    // 'employment',
    // 'energy',
    'engineering',
    'enjoyment',
    // 'entertainment',
    'envy',
    'equipment',
    'ethics',
    'evidence',
    'evolution',

    // 'failure',
    // 'faith',
    'fame',
    'fiction',
    // 'fish',
    'flour',
    'flu',
    'food',
    // 'freedom',
    // 'fruit',
    'fuel',
    'fun',
    // 'funeral',
    'furniture',

    'gallows',
    'garbage',
    'garlic',
    // 'gas',
    'genetics',
    // 'glass',
    'gold',
    'golf',
    'gossip',
    'grammar',
    // 'grass',
    'gratitude',
    'grief',
    // 'ground',
    'guilt',
    'gymnastics',

    // 'hair',
    'happiness',
    'hardware',
    'harm',
    'hate',
    'hatred',
    'health',
    'heat',
    // 'height',
    'help',
    'homework',
    'honesty',
    'honey',
    'hospitality',
    'housework',
    'humour',
    'hunger',
    'hydrogen',

    'ice',
    'importance',
    'inflation',
    'information',
    // 'injustice',
    'innocence',
    // 'intelligence',
    'iron',
    'irony',

    'jam',
    // 'jealousy',
    // 'jelly',
    'jewelry',
    // 'joy',
    'judo',
    // 'juice',
    // 'justice',

    'karate',
    // 'kindness',
    'knowledge',

    // 'labour',
    'lack',
    // 'land',
    'laughter',
    'lava',
    'leather',
    'leisure',
    'lightning',
    'linguine',
    'linguini',
    'linguistics',
    'literature',
    'litter',
    'livestock',
    'logic',
    'loneliness',
    // 'love',
    'luck',
    'luggage',

    'macaroni',
    'machinery',
    'magic',
    // 'mail',
    'management',
    'mankind',
    'marble',
    'mathematics',
    'mayonnaise',
    'measles',
    // 'meat',
    // 'metal',
    'methane',
    'milk',
    'money',
    // 'moose',
    'mud',
    'music',
    'mumps',

    'nature',
    'news',
    'nitrogen',
    'nonsense',
    'nurture',
    'nutrition',

    'obedience',
    'obesity',
    // 'oil',
    'oxygen',

    // 'paper',
    // 'passion',
    'pasta',
    'patience',
    // 'permission',
    'physics',
    'poetry',
    'pollution',
    'poverty',
    // 'power',
    'pride',
    // 'production',
    // 'progress',
    // 'pronunciation',
    'psychology',
    'publicity',
    'punctuation',

    // 'quality',
    // 'quantity',
    'quartz',

    'racism',
    // 'rain',
    // 'recreation',
    'relaxation',
    'reliability',
    'research',
    'respect',
    'revenge',
    'rice',
    'rubbish',
    'rum',

    'safety',
    // 'salad',
    // 'salt',
    // 'sand',
    // 'satire',
    'scenery',
    'seafood',
    'seaside',
    'series',
    'shame',
    'sheep',
    'shopping',
    // 'silence',
    'sleep',
    // 'slang'
    'smoke',
    'smoking',
    'snow',
    'soap',
    'software',
    'soil',
    // 'sorrow',
    // 'soup',
    'spaghetti',
    // 'speed',
    'species',
    // 'spelling',
    // 'sport',
    'steam',
    // 'strength',
    'stuff',
    'stupidity',
    // 'success',
    // 'sugar',
    'sunshine',
    'symmetry',

    // 'tea',
    'tennis',
    'thirst',
    'thunder',
    'timber',
    // 'time',
    // 'toast',
    // 'tolerance',
    // 'trade',
    'traffic',
    'transportation',
    // 'travel',
    'trust',

    // 'understanding',
    'underwear',
    'unemployment',
    'unity',
    // 'usage',

    'validity',
    'veal',
    'vegetation',
    'vegetarianism',
    'vengeance',
    'violence',
    // 'vision',
    'vitality',

    'warmth',
    // 'water',
    'wealth',
    'weather',
    // 'weight',
    'welfare',
    'wheat',
    // 'whiskey',
    // 'width',
    'wildlife',
    // 'wine',
    'wisdom',
    // 'wood',
    // 'wool',
    // 'work',

    // 'yeast',
    'yoga',

    'zinc',
    'zoology'
  ];

  /**
   * @description These rules translate from the singular form of a noun to its plural form.
   * @private
   */

  var regex = {
    plural : {
      men       : new RegExp( '^(m)en$'    , 'gi' ),
      people    : new RegExp( '(pe)ople$'  , 'gi' ),
      children  : new RegExp( '(child)ren$', 'gi' ),
      tia       : new RegExp( '([ti])a$'   , 'gi' ),
      analyses  : new RegExp( '((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$','gi' ),
      hives     : new RegExp( '(hi|ti)ves$'       , 'gi' ),
      curves    : new RegExp( '(curve)s$'         , 'gi' ),
      lrves     : new RegExp( '([lr])ves$'        , 'gi' ),
      foves     : new RegExp( '([^fo])ves$'       , 'gi' ),
      movies    : new RegExp( '(m)ovies$'         , 'gi' ),
      aeiouyies : new RegExp( '([^aeiouy]|qu)ies$', 'gi' ),
      series    : new RegExp( '(s)eries$'         , 'gi' ),
      xes       : new RegExp( '(x|ch|ss|sh)es$'   , 'gi' ),
      mice      : new RegExp( '([m|l])ice$'       , 'gi' ),
      buses     : new RegExp( '(bus)es$'          , 'gi' ),
      oes       : new RegExp( '(o)es$'            , 'gi' ),
      shoes     : new RegExp( '(shoe)s$'          , 'gi' ),
      crises    : new RegExp( '(cris|ax|test)es$' , 'gi' ),
      octopi    : new RegExp( '(octop|vir)i$'     , 'gi' ),
      aliases   : new RegExp( '(alias|status)es$' , 'gi' ),
      summonses : new RegExp( '^(summons)es$'     , 'gi' ),
      oxen      : new RegExp( '^(ox)en'           , 'gi' ),
      matrices  : new RegExp( '(matr)ices$'       , 'gi' ),
      vertices  : new RegExp( '(vert|ind)ices$'   , 'gi' ),
      feet      : new RegExp( '^feet$'            , 'gi' ),
      teeth     : new RegExp( '^teeth$'           , 'gi' ),
      geese     : new RegExp( '^geese$'           , 'gi' ),
      quizzes   : new RegExp( '(quiz)zes$'        , 'gi' ),
      whereases : new RegExp( '^(whereas)es$'     , 'gi' ),
      ss        : new RegExp( 'ss$'               , 'gi' ),
      s         : new RegExp( 's$'                , 'gi' )
    },

    singular : {
      man     : new RegExp( '^(m)an$'               , 'gi' ),
      person  : new RegExp( '(pe)rson$'             , 'gi' ),
      child   : new RegExp( '(child)$'              , 'gi' ),
      ox      : new RegExp( '^(ox)$'                , 'gi' ),
      axis    : new RegExp( '(ax|test)is$'          , 'gi' ),
      octopus : new RegExp( '(octop|vir)us$'        , 'gi' ),
      alias   : new RegExp( '(alias|status)$'       , 'gi' ),
      summons : new RegExp( '^(summons)$'           , 'gi' ),
      bus     : new RegExp( '(bu)s$'                , 'gi' ),
      buffalo : new RegExp( '(buffal|tomat|potat)o$', 'gi' ),
      tium    : new RegExp( '([ti])um$'             , 'gi' ),
      sis     : new RegExp( 'sis$'                  , 'gi' ),
      ffe     : new RegExp( '(?:([^f])fe|([lr])f)$' , 'gi' ),
      hive    : new RegExp( '(hi|ti)ve$'            , 'gi' ),
      aeiouyy : new RegExp( '([^aeiouy]|qu)y$'      , 'gi' ),
      x       : new RegExp( '(x|ch|ss|sh)$'         , 'gi' ),
      matrix  : new RegExp( '(matr)ix$'             , 'gi' ),
      vertex  : new RegExp( '(vert|ind)ex$'         , 'gi' ),
      mouse   : new RegExp( '([m|l])ouse$'          , 'gi' ),
      foot    : new RegExp( '^foot$'                , 'gi' ),
      tooth   : new RegExp( '^tooth$'               , 'gi' ),
      goose   : new RegExp( '^goose$'               , 'gi' ),
      quiz    : new RegExp( '(quiz)$'               , 'gi' ),
      whereas : new RegExp( '^(whereas)$'           , 'gi' ),
      s       : new RegExp( 's$'                    , 'gi' ),
      common  : new RegExp( '$'                     , 'gi' )
    }
  };

  var plural_rules = [

    // do not replace if its already a plural word
    [ regex.plural.men       ],
    [ regex.plural.people    ],
    [ regex.plural.children  ],
    [ regex.plural.tia       ],
    [ regex.plural.analyses  ],
    [ regex.plural.hives     ],
    [ regex.plural.curves    ],
    [ regex.plural.lrves     ],
    [ regex.plural.foves     ],
    [ regex.plural.aeiouyies ],
    [ regex.plural.series    ],
    [ regex.plural.movies    ],
    [ regex.plural.xes       ],
    [ regex.plural.mice      ],
    [ regex.plural.buses     ],
    [ regex.plural.oes       ],
    [ regex.plural.shoes     ],
    [ regex.plural.crises    ],
    [ regex.plural.octopi    ],
    [ regex.plural.aliases   ],
    [ regex.plural.summonses ],
    [ regex.plural.oxen      ],
    [ regex.plural.matrices  ],
    [ regex.plural.feet      ],
    [ regex.plural.teeth     ],
    [ regex.plural.geese     ],
    [ regex.plural.quizzes   ],
    [ regex.plural.whereases ],

    // original rule
    [ regex.singular.man    , '$1en' ],
    [ regex.singular.person , '$1ople' ],
    [ regex.singular.child  , '$1ren' ],
    [ regex.singular.ox     , '$1en' ],
    [ regex.singular.axis   , '$1es' ],
    [ regex.singular.octopus, '$1i' ],
    [ regex.singular.alias  , '$1es' ],
    [ regex.singular.summons, '$1es' ],
    [ regex.singular.bus    , '$1ses' ],
    [ regex.singular.buffalo, '$1oes' ],
    [ regex.singular.tium   , '$1a' ],
    [ regex.singular.sis    , 'ses' ],
    [ regex.singular.ffe    , '$1$2ves' ],
    [ regex.singular.hive   , '$1ves' ],
    [ regex.singular.aeiouyy, '$1ies' ],
    [ regex.singular.x      , '$1es' ],
    [ regex.singular.matrix , '$1ices' ],
    [ regex.singular.vertex , '$1ices' ],
    [ regex.singular.mouse  , '$1ice' ],
    [ regex.singular.foot   , 'feet' ],
    [ regex.singular.tooth  , 'teeth' ],
    [ regex.singular.goose  , 'geese' ],
    [ regex.singular.quiz   , '$1zes' ],
    [ regex.singular.whereas, '$1es' ],

    [ regex.singular.s     , 's' ],
    [ regex.singular.common, 's' ]
  ];

  /**
   * @description These rules translate from the plural form of a noun to its singular form.
   * @private
   */
  var singular_rules = [

    // do not replace if its already a singular word
    [ regex.singular.man     ],
    [ regex.singular.person  ],
    [ regex.singular.child   ],
    [ regex.singular.ox      ],
    [ regex.singular.axis    ],
    [ regex.singular.octopus ],
    [ regex.singular.alias   ],
    [ regex.singular.summons ],
    [ regex.singular.bus     ],
    [ regex.singular.buffalo ],
    [ regex.singular.tium    ],
    [ regex.singular.sis     ],
    [ regex.singular.ffe     ],
    [ regex.singular.hive    ],
    [ regex.singular.aeiouyy ],
    [ regex.singular.x       ],
    [ regex.singular.matrix  ],
    [ regex.singular.mouse   ],
    [ regex.singular.foot    ],
    [ regex.singular.tooth   ],
    [ regex.singular.goose   ],
    [ regex.singular.quiz    ],
    [ regex.singular.whereas ],

    // original rule
    [ regex.plural.men      , '$1an' ],
    [ regex.plural.people   , '$1rson' ],
    [ regex.plural.children , '$1' ],
    [ regex.plural.tia      , '$1um' ],
    [ regex.plural.analyses , '$1$2sis' ],
    [ regex.plural.hives    , '$1ve' ],
    [ regex.plural.curves   , '$1' ],
    [ regex.plural.lrves    , '$1f' ],
    [ regex.plural.foves    , '$1fe' ],
    [ regex.plural.movies   , '$1ovie' ],
    [ regex.plural.aeiouyies, '$1y' ],
    [ regex.plural.series   , '$1eries' ],
    [ regex.plural.xes      , '$1' ],
    [ regex.plural.mice     , '$1ouse' ],
    [ regex.plural.buses    , '$1' ],
    [ regex.plural.oes      , '$1' ],
    [ regex.plural.shoes    , '$1' ],
    [ regex.plural.crises   , '$1is' ],
    [ regex.plural.octopi   , '$1us' ],
    [ regex.plural.aliases  , '$1' ],
    [ regex.plural.summonses, '$1' ],
    [ regex.plural.oxen     , '$1' ],
    [ regex.plural.matrices , '$1ix' ],
    [ regex.plural.vertices , '$1ex' ],
    [ regex.plural.feet     , 'foot' ],
    [ regex.plural.teeth    , 'tooth' ],
    [ regex.plural.geese    , 'goose' ],
    [ regex.plural.quizzes  , '$1' ],
    [ regex.plural.whereases, '$1' ],

    [ regex.plural.ss, 'ss' ],
    [ regex.plural.s , '' ]
  ];

  /**
   * @description This is a list of words that should not be capitalized for title case.
   * @private
   */
  var non_titlecased_words = [
    'and', 'or', 'nor', 'a', 'an', 'the', 'so', 'but', 'to', 'of', 'at','by',
    'from', 'into', 'on', 'onto', 'off', 'out', 'in', 'over', 'with', 'for'
  ];

  /**
   * @description These are regular expressions used for converting between String formats.
   * @private
   */
  var id_suffix         = new RegExp( '(_ids|_id)$', 'g' );
  var underbar          = new RegExp( '_', 'g' );
  var space_or_underbar = new RegExp( '[\ _]', 'g' );
  var uppercase         = new RegExp( '([A-Z])', 'g' );
  var underbar_prefix   = new RegExp( '^_' );

  var inflector = {

  /**
   * A helper method that applies rules based replacement to a String.
   * @private
   * @function
   * @param {String} str String to modify and return based on the passed rules.
   * @param {Array: [RegExp, String]} rules Regexp to match paired with String to use for replacement
   * @param {Array: [String]} skip Strings to skip if they match
   * @param {String} override String to return as though this method succeeded (used to conform to APIs)
   * @returns {String} Return passed String modified by passed rules.
   * @example
   *
   *     this._apply_rules( 'cows', singular_rules ); // === 'cow'
   */
    _apply_rules : function ( str, rules, skip, override ){
      if( override ){
        str = override;
      }else{
        var ignore = ( inflector.indexOf( skip, str.toLowerCase()) > -1 );

        if( !ignore ){
          var i = 0;
          var j = rules.length;

          for( ; i < j; i++ ){
            if( str.match( rules[ i ][ 0 ])){
              if( rules[ i ][ 1 ] !== undefined ){
                str = str.replace( rules[ i ][ 0 ], rules[ i ][ 1 ]);
              }
              break;
            }
          }
        }
      }

      return str;
    },



  /**
   * This lets us detect if an Array contains a given element.
   * @public
   * @function
   * @param {Array} arr The subject array.
   * @param {Object} item Object to locate in the Array.
   * @param {Number} from_index Starts checking from this position in the Array.(optional)
   * @param {Function} compare_func Function used to compare Array item vs passed item.(optional)
   * @returns {Number} Return index position in the Array of the passed item.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.indexOf([ 'hi','there' ], 'guys' ); // === -1
   *     inflection.indexOf([ 'hi','there' ], 'hi' ); // === 0
   */
    indexOf : function ( arr, item, from_index, compare_func ){
      if( !from_index ){
        from_index = -1;
      }

      var index = -1;
      var i     = from_index;
      var j     = arr.length;

      for( ; i < j; i++ ){
        if( arr[ i ]  === item || compare_func && compare_func( arr[ i ], item )){
          index = i;
          break;
        }
      }

      return index;
    },



  /**
   * This function adds pluralization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {String} plural Overrides normal output with said String.(optional)
   * @returns {String} Singular English language nouns are returned in plural form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.pluralize( 'person' ); // === 'people'
   *     inflection.pluralize( 'octopus' ); // === 'octopi'
   *     inflection.pluralize( 'Hat' ); // === 'Hats'
   *     inflection.pluralize( 'person', 'guys' ); // === 'guys'
   */
    pluralize : function ( str, plural ){
      return inflector._apply_rules( str, plural_rules, uncountable_words, plural );
    },



  /**
   * This function adds singularization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {String} singular Overrides normal output with said String.(optional)
   * @returns {String} Plural English language nouns are returned in singular form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.singularize( 'people' ); // === 'person'
   *     inflection.singularize( 'octopi' ); // === 'octopus'
   *     inflection.singularize( 'Hats' ); // === 'Hat'
   *     inflection.singularize( 'guys', 'person' ); // === 'person'
   */
    singularize : function ( str, singular ){
      return inflector._apply_rules( str, singular_rules, uncountable_words, singular );
    },


  /**
   * This function will pluralize or singularlize a String appropriately based on an integer value
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Number} count The number to base pluralization off of.
   * @param {String} singular Overrides normal output with said String.(optional)
   * @param {String} plural Overrides normal output with said String.(optional)
   * @returns {String} English language nouns are returned in the plural or singular form based on the count.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.inflect( 'people' 1 ); // === 'person'
   *     inflection.inflect( 'octopi' 1 ); // === 'octopus'
   *     inflection.inflect( 'Hats' 1 ); // === 'Hat'
   *     inflection.inflect( 'guys', 1 , 'person' ); // === 'person'
   *     inflection.inflect( 'person', 2 ); // === 'people'
   *     inflection.inflect( 'octopus', 2 ); // === 'octopi'
   *     inflection.inflect( 'Hat', 2 ); // === 'Hats'
   *     inflection.inflect( 'person', 2, null, 'guys' ); // === 'guys'
   */
    inflect : function ( str, count, singular, plural ){
      count = parseInt( count, 10 );

      if( isNaN( count )) return str;

      if( count === 0 || count > 1 ){
        return inflector._apply_rules( str, plural_rules, uncountable_words, plural );
      }else{
        return inflector._apply_rules( str, singular_rules, uncountable_words, singular );
      }
    },



  /**
   * This function adds camelization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} low_first_letter Default is to capitalize the first letter of the results.(optional)
   *                                 Passing true will lowercase it.
   * @returns {String} Lower case underscored words will be returned in camel case.
   *                  additionally '/' is translated to '::'
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.camelize( 'message_properties' ); // === 'MessageProperties'
   *     inflection.camelize( 'message_properties', true ); // === 'messageProperties'
   */
    camelize : function ( str, low_first_letter ){
      var str_path = str.split( '/' );
      var i        = 0;
      var j        = str_path.length;
      var str_arr, init_x, k, l, first;

      for( ; i < j; i++ ){
        str_arr = str_path[ i ].split( '_' );
        k       = 0;
        l       = str_arr.length;

        for( ; k < l; k++ ){
          if( k !== 0 ){
            str_arr[ k ] = str_arr[ k ].toLowerCase();
          }

          first = str_arr[ k ].charAt( 0 );
          first = low_first_letter && i === 0 && k === 0
            ? first.toLowerCase() : first.toUpperCase();
          str_arr[ k ] = first + str_arr[ k ].substring( 1 );
        }

        str_path[ i ] = str_arr.join( '' );
      }

      return str_path.join( '::' );
    },



  /**
   * This function adds underscore support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} all_upper_case Default is to lowercase and add underscore prefix.(optional)
   *                  Passing true will return as entered.
   * @returns {String} Camel cased words are returned as lower cased and underscored.
   *                  additionally '::' is translated to '/'.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.underscore( 'MessageProperties' ); // === 'message_properties'
   *     inflection.underscore( 'messageProperties' ); // === 'message_properties'
   *     inflection.underscore( 'MP', true ); // === 'MP'
   */
    underscore : function ( str, all_upper_case ){
      if( all_upper_case && str === str.toUpperCase()) return str;

      var str_path = str.split( '::' );
      var i        = 0;
      var j        = str_path.length;

      for( ; i < j; i++ ){
        str_path[ i ] = str_path[ i ].replace( uppercase, '_$1' );
        str_path[ i ] = str_path[ i ].replace( underbar_prefix, '' );
      }

      return str_path.join( '/' ).toLowerCase();
    },



  /**
   * This function adds humanize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} low_first_letter Default is to capitalize the first letter of the results.(optional)
   *                                 Passing true will lowercase it.
   * @returns {String} Lower case underscored words will be returned in humanized form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.humanize( 'message_properties' ); // === 'Message properties'
   *     inflection.humanize( 'message_properties', true ); // === 'message properties'
   */
    humanize : function ( str, low_first_letter ){
      str = str.toLowerCase();
      str = str.replace( id_suffix, '' );
      str = str.replace( underbar, ' ' );

      if( !low_first_letter ){
        str = inflector.capitalize( str );
      }

      return str;
    },



  /**
   * This function adds capitalization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} All characters will be lower case and the first will be upper.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.capitalize( 'message_properties' ); // === 'Message_properties'
   *     inflection.capitalize( 'message properties', true ); // === 'Message properties'
   */
    capitalize : function ( str ){
      str = str.toLowerCase();

      return str.substring( 0, 1 ).toUpperCase() + str.substring( 1 );
    },



  /**
   * This function replaces underscores with dashes in the string.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Replaces all spaces or underscores with dashes.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.dasherize( 'message_properties' ); // === 'message-properties'
   *     inflection.dasherize( 'Message Properties' ); // === 'Message-Properties'
   */
    dasherize : function ( str ){
      return str.replace( space_or_underbar, '-' );
    },



  /**
   * This function adds titleize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Capitalizes words as you would for a book title.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.titleize( 'message_properties' ); // === 'Message Properties'
   *     inflection.titleize( 'message properties to keep' ); // === 'Message Properties to Keep'
   */
    titleize : function ( str ){
      str         = str.toLowerCase().replace( underbar, ' ' );
      var str_arr = str.split( ' ' );
      var i       = 0;
      var j       = str_arr.length;
      var d, k, l;

      for( ; i < j; i++ ){
        d = str_arr[ i ].split( '-' );
        k = 0;
        l = d.length;

        for( ; k < l; k++){
          if( inflector.indexOf( non_titlecased_words, d[ k ].toLowerCase()) < 0 ){
            d[ k ] = inflector.capitalize( d[ k ]);
          }
        }

        str_arr[ i ] = d.join( '-' );
      }

      str = str_arr.join( ' ' );
      str = str.substring( 0, 1 ).toUpperCase() + str.substring( 1 );

      return str;
    },



  /**
   * This function adds demodulize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Removes module names leaving only class names.(Ruby style)
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.demodulize( 'Message::Bus::Properties' ); // === 'Properties'
   */
    demodulize : function ( str ){
      var str_arr = str.split( '::' );

      return str_arr[ str_arr.length - 1 ];
    },



  /**
   * This function adds tableize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Return camel cased words into their underscored plural form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.tableize( 'MessageBusProperty' ); // === 'message_bus_properties'
   */
    tableize : function ( str ){
      str = inflector.underscore( str );
      str = inflector.pluralize( str );

      return str;
    },



  /**
   * This function adds classification support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Underscored plural nouns become the camel cased singular form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.classify( 'message_bus_properties' ); // === 'MessageBusProperty'
   */
    classify : function ( str ){
      str = inflector.camelize( str );
      str = inflector.singularize( str );

      return str;
    },



  /**
   * This function adds foreign key support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} drop_id_ubar Default is to seperate id with an underbar at the end of the class name,
                                 you can pass true to skip it.(optional)
   * @returns {String} Underscored plural nouns become the camel cased singular form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.foreign_key( 'MessageBusProperty' ); // === 'message_bus_property_id'
   *     inflection.foreign_key( 'MessageBusProperty', true ); // === 'message_bus_propertyid'
   */
    foreign_key : function ( str, drop_id_ubar ){
      str = inflector.demodulize( str );
      str = inflector.underscore( str ) + (( drop_id_ubar ) ? ( '' ) : ( '_' )) + 'id';

      return str;
    },



  /**
   * This function adds ordinalize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Return all found numbers their sequence like '22nd'.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.ordinalize( 'the 1 pitch' ); // === 'the 1st pitch'
   */
    ordinalize : function ( str ){
      var str_arr = str.split( ' ' );
      var i       = 0;
      var j       = str_arr.length;

      for( ; i < j; i++ ){
        var k = parseInt( str_arr[ i ], 10 );

        if( !isNaN( k )){
          var ltd = str_arr[ i ].substring( str_arr[ i ].length - 2 );
          var ld  = str_arr[ i ].substring( str_arr[ i ].length - 1 );
          var suf = 'th';

          if( ltd != '11' && ltd != '12' && ltd != '13' ){
            if( ld === '1' ){
              suf = 'st';
            }else if( ld === '2' ){
              suf = 'nd';
            }else if( ld === '3' ){
              suf = 'rd';
            }
          }

          str_arr[ i ] += suf;
        }
      }

      return str_arr.join( ' ' );
    },

  /**
   * This function performs multiple inflection methods on a string
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Array} arr An array of inflection methods.
   * @returns {String}
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.transform( 'all job', [ 'pluralize', 'capitalize', 'dasherize' ]); // === 'All-jobs'
   */
    transform : function ( str, arr ){
      var i = 0;
      var j = arr.length;

      for( ;i < j; i++ ){
        var method = arr[ i ];

        if( this.hasOwnProperty( method )){
          str = this[ method ]( str );
        }
      }

      return str;
    }
  };

/**
 * @public
 */
  inflector.version = '1.5.3';

  return inflector;
}));

},{}],"rsvp":[function(require,module,exports){
module.exports = window.RSVP;
},{}],"underscore":[function(require,module,exports){
module.exports = window._;
},{}]},{},[1]);

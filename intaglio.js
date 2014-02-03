!function(e){"object"==typeof exports?module.exports=e():"function"==typeof define&&define.amd?define(e):"undefined"!=typeof window?window.Intaglio=e():"undefined"!=typeof global?global.Intaglio=e():"undefined"!=typeof self&&(self.Intaglio=e())}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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
},{"./lib/decorators":3,"./lib/orm":6,"./lib/repositories":11,"./lib/utils":24,"rsvp":"psHlfu"}],2:[function(require,module,exports){
var _ = require('underscore');

var EmberDecorator = {
	unknownProperty: function (key) {
		return this.get(key);
	},

	setUnknownProperty: function (key, value) {
		Ember.propertyWillChange(this, key);

		this.set(key, value);

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
},{"underscore":"69U/Pa"}],3:[function(require,module,exports){
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
	trigger: function (event) {
		// Make sure object isn't deleted
		this._checkDeleted();

		// Do nothing if there are no events
		if (this._events[event] === undefined)
			return;

		var self = this;

		// Fire each callback registered to the event
		_.each(this._events[event], function (callback) {
			callback.apply(self);
		});
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
		
		var self = this;

		// Handle passing objects
		if (_.isObject(key)) {
			_.each(key, function(v, k) {
				self._data[k] = v;
			});
		}
		else {
			this._data[key] = value;
		}

		return this;
	},

	save: function () {
		// Make sure object isn't deleted
		this._checkDeleted();
		
		var self = this;

		this.trigger('save');

		return new RSVP.Promise(function (resolve, reject) {
			var savePromise;

			// Do a create if it's new
			if (self._isNew) {
				savePromise = self._repository.create(self._model, self._model.translateObjectToRepository(self._data));
			}
			else {
				if (self.getFieldsPendingChange().length === 0)
					return resolve(self);

				savePromise = self._repository.save(self._model, self._model.translateObjectToRepository(self._originalData), self._model.translateObjectToRepository(self._data));
			}

			savePromise.then(function (data) {
				self._parseData(self._model.translateObjectToOrm(data));

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

},{"./../utils":24,"rsvp":"psHlfu","underscore":"69U/Pa"}],5:[function(require,module,exports){
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
},{"./../utils":24,"./where":8,"rsvp":"psHlfu","underscore":"69U/Pa"}],6:[function(require,module,exports){
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
},{"../repositories":11,"./orm":7,"rsvp":"psHlfu","underscore":"69U/Pa"}],7:[function(require,module,exports){
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
	 * @member
	 */
	_readyPromise: null,

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

			// Bump the next id
			nextId++;
		}
	});
}
},{"./../utils":24,"./basemodel":4,"./factory":5,"rsvp":"psHlfu","underscore":"69U/Pa"}],8:[function(require,module,exports){
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
},{"./../utils":24,"rsvp":"psHlfu","underscore":"69U/Pa"}],9:[function(require,module,exports){
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
},{"./../../utils":24,"rsvp":"psHlfu","underscore":"69U/Pa"}],10:[function(require,module,exports){
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
},{"./../../../utils":24,"./response":14,"rsvp":"psHlfu","underscore":"69U/Pa"}],13:[function(require,module,exports){
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
},{"./../../../utils":24,"./response":14,"request":25,"rsvp":"psHlfu","underscore":"69U/Pa"}],14:[function(require,module,exports){
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
},{"./../../schema":18,"./../../utils":24,"./../abstract/repository":9,"./driver/jquery":12,"./driver/mock":25,"./driver/node":13,"./where":16,"rsvp":"psHlfu","underscore":"69U/Pa"}],16:[function(require,module,exports){
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
},{"./../../utils":24,"./../abstract/where":10,"underscore":"69U/Pa"}],17:[function(require,module,exports){
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
},{"./../utils":24,"underscore":"69U/Pa"}],18:[function(require,module,exports){
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
},{"./../utils":24,"./abstract":17,"./property":20,"inflection":26,"underscore":"69U/Pa"}],20:[function(require,module,exports){
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
},{"./../utils":24,"./abstract":17,"underscore":"69U/Pa"}],21:[function(require,module,exports){
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
},{"./../utils":24,"./model":19,"underscore":"69U/Pa"}],22:[function(require,module,exports){
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
},{"./class":22,"./exceptions":23,"inflection":26,"underscore":"69U/Pa"}],25:[function(require,module,exports){

},{}],26:[function(require,module,exports){
/*!
 * inflection
 * Copyright(c) 2011 Ben Lin <ben@dreamerslab.com>
 * MIT Licensed
 *
 * @fileoverview
 * A port of inflection-js to node.js module.
 */

( function ( root ){

  /**
   * @description This is a list of nouns that use the same form for both singular and plural.
   *              This list should remain entirely in lower case to correctly match Strings.
   * @private
   */
  var uncountable_words = [
    'equipment', 'information', 'rice', 'money', 'species',
    'series', 'fish', 'sheep', 'moose', 'deer', 'news'
  ];

  /**
   * @description These rules translate from the singular form of a noun to its plural form.
   * @private
   */
  var plural_rules = [

    // do not replace if its already a plural word
    [ new RegExp( '(m)en$',      'gi' )],
    [ new RegExp( '(pe)ople$',   'gi' )],
    [ new RegExp( '(child)ren$', 'gi' )],
    [ new RegExp( '([ti])a$',    'gi' )],
    [ new RegExp( '((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$','gi' )],
    [ new RegExp( '(hive)s$',           'gi' )],
    [ new RegExp( '(tive)s$',           'gi' )],
    [ new RegExp( '(curve)s$',          'gi' )],
    [ new RegExp( '([lr])ves$',         'gi' )],
    [ new RegExp( '([^fo])ves$',        'gi' )],
    [ new RegExp( '([^aeiouy]|qu)ies$', 'gi' )],
    [ new RegExp( '(s)eries$',          'gi' )],
    [ new RegExp( '(m)ovies$',          'gi' )],
    [ new RegExp( '(x|ch|ss|sh)es$',    'gi' )],
    [ new RegExp( '([m|l])ice$',        'gi' )],
    [ new RegExp( '(bus)es$',           'gi' )],
    [ new RegExp( '(o)es$',             'gi' )],
    [ new RegExp( '(shoe)s$',           'gi' )],
    [ new RegExp( '(cris|ax|test)es$',  'gi' )],
    [ new RegExp( '(octop|vir)i$',      'gi' )],
    [ new RegExp( '(alias|status)es$',  'gi' )],
    [ new RegExp( '^(ox)en',            'gi' )],
    [ new RegExp( '(vert|ind)ices$',    'gi' )],
    [ new RegExp( '(matr)ices$',        'gi' )],
    [ new RegExp( '(quiz)zes$',         'gi' )],

    // original rule
    [ new RegExp( '(m)an$', 'gi' ),                 '$1en' ],
    [ new RegExp( '(pe)rson$', 'gi' ),              '$1ople' ],
    [ new RegExp( '(child)$', 'gi' ),               '$1ren' ],
    [ new RegExp( '^(ox)$', 'gi' ),                 '$1en' ],
    [ new RegExp( '(ax|test)is$', 'gi' ),           '$1es' ],
    [ new RegExp( '(octop|vir)us$', 'gi' ),         '$1i' ],
    [ new RegExp( '(alias|status)$', 'gi' ),        '$1es' ],
    [ new RegExp( '(bu)s$', 'gi' ),                 '$1ses' ],
    [ new RegExp( '(buffal|tomat|potat)o$', 'gi' ), '$1oes' ],
    [ new RegExp( '([ti])um$', 'gi' ),              '$1a' ],
    [ new RegExp( 'sis$', 'gi' ),                   'ses' ],
    [ new RegExp( '(?:([^f])fe|([lr])f)$', 'gi' ),  '$1$2ves' ],
    [ new RegExp( '(hive)$', 'gi' ),                '$1s' ],
    [ new RegExp( '([^aeiouy]|qu)y$', 'gi' ),       '$1ies' ],
    [ new RegExp( '(x|ch|ss|sh)$', 'gi' ),          '$1es' ],
    [ new RegExp( '(matr|vert|ind)ix|ex$', 'gi' ),  '$1ices' ],
    [ new RegExp( '([m|l])ouse$', 'gi' ),           '$1ice' ],
    [ new RegExp( '(quiz)$', 'gi' ),                '$1zes' ],

    [ new RegExp( 's$', 'gi' ), 's' ],
    [ new RegExp( '$', 'gi' ),  's' ]
  ];

  /**
   * @description These rules translate from the plural form of a noun to its singular form.
   * @private
   */
  var singular_rules = [

    // do not replace if its already a singular word
    [ new RegExp( '(m)an$',                 'gi' )],
    [ new RegExp( '(pe)rson$',              'gi' )],
    [ new RegExp( '(child)$',               'gi' )],
    [ new RegExp( '^(ox)$',                 'gi' )],
    [ new RegExp( '(ax|test)is$',           'gi' )],
    [ new RegExp( '(octop|vir)us$',         'gi' )],
    [ new RegExp( '(alias|status)$',        'gi' )],
    [ new RegExp( '(bu)s$',                 'gi' )],
    [ new RegExp( '(buffal|tomat|potat)o$', 'gi' )],
    [ new RegExp( '([ti])um$',              'gi' )],
    [ new RegExp( 'sis$',                   'gi' )],
    [ new RegExp( '(?:([^f])fe|([lr])f)$',  'gi' )],
    [ new RegExp( '(hive)$',                'gi' )],
    [ new RegExp( '([^aeiouy]|qu)y$',       'gi' )],
    [ new RegExp( '(x|ch|ss|sh)$',          'gi' )],
    [ new RegExp( '(matr|vert|ind)ix|ex$',  'gi' )],
    [ new RegExp( '([m|l])ouse$',           'gi' )],
    [ new RegExp( '(quiz)$',                'gi' )],

    // original rule
    [ new RegExp( '(m)en$', 'gi' ),                                                       '$1an' ],
    [ new RegExp( '(pe)ople$', 'gi' ),                                                    '$1rson' ],
    [ new RegExp( '(child)ren$', 'gi' ),                                                  '$1' ],
    [ new RegExp( '([ti])a$', 'gi' ),                                                     '$1um' ],
    [ new RegExp( '((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$','gi' ), '$1$2sis' ],
    [ new RegExp( '(hive)s$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(tive)s$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(curve)s$', 'gi' ),                                                    '$1' ],
    [ new RegExp( '([lr])ves$', 'gi' ),                                                   '$1f' ],
    [ new RegExp( '([^fo])ves$', 'gi' ),                                                  '$1fe' ],
    [ new RegExp( '([^aeiouy]|qu)ies$', 'gi' ),                                           '$1y' ],
    [ new RegExp( '(s)eries$', 'gi' ),                                                    '$1eries' ],
    [ new RegExp( '(m)ovies$', 'gi' ),                                                    '$1ovie' ],
    [ new RegExp( '(x|ch|ss|sh)es$', 'gi' ),                                              '$1' ],
    [ new RegExp( '([m|l])ice$', 'gi' ),                                                  '$1ouse' ],
    [ new RegExp( '(bus)es$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(o)es$', 'gi' ),                                                       '$1' ],
    [ new RegExp( '(shoe)s$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(cris|ax|test)es$', 'gi' ),                                            '$1is' ],
    [ new RegExp( '(octop|vir)i$', 'gi' ),                                                '$1us' ],
    [ new RegExp( '(alias|status)es$', 'gi' ),                                            '$1' ],
    [ new RegExp( '^(ox)en', 'gi' ),                                                      '$1' ],
    [ new RegExp( '(vert|ind)ices$', 'gi' ),                                              '$1ex' ],
    [ new RegExp( '(matr)ices$', 'gi' ),                                                  '$1ix' ],
    [ new RegExp( '(quiz)zes$', 'gi' ),                                                   '$1' ],
    [ new RegExp( 'ss$', 'gi' ),                                                          'ss' ],
    [ new RegExp( 's$', 'gi' ),                                                           '' ]
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
    _apply_rules : function( str, rules, skip, override ){
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
   * @param {Number} fromIndex Starts checking from this position in the Array.(optional)
   * @param {Function} compareFunc Function used to compare Array item vs passed item.(optional)
   * @returns {Number} Return index position in the Array of the passed item.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.indexOf([ 'hi','there' ], 'guys' ); // === -1
   *     inflection.indexOf([ 'hi','there' ], 'hi' ); // === 0
   */
    indexOf : function( arr, item, fromIndex, compareFunc ){
      if( !fromIndex ){
        fromIndex = -1;
      }

      var index = -1;
      var i     = fromIndex;
      var j     = arr.length;

      for( ; i < j; i++ ){
        if( arr[ i ]  === item || compareFunc && compareFunc( arr[ i ], item )){
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
   * This function adds camelization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} lowFirstLetter Default is to capitalize the first letter of the results.(optional)
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
    camelize : function ( str, lowFirstLetter ){
      var str_path = str.toLowerCase().split( '/' );
      var i        = 0;
      var j        = str_path.length;

      for( ; i < j; i++ ){
        var str_arr = str_path[ i ].split( '_' );
        var initX   = (( lowFirstLetter && i + 1 === j ) ? ( 1 ) : ( 0 ));
        var k       = initX;
        var l       = str_arr.length;

        for( ; k < l; k++ ){
          str_arr[ k ] = str_arr[ k ].charAt( 0 ).toUpperCase() + str_arr[ k ].substring( 1 );
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
   * @param {Boolean} allUpperCase Default is to lowercase and add underscore prefix.(optional)
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
    underscore : function ( str, allUpperCase ){
      if( allUpperCase && str === str.toUpperCase()) return str;

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
   * @param {Boolean} lowFirstLetter Default is to capitalize the first letter of the results.(optional)
   *                                 Passing true will lowercase it.
   * @returns {String} Lower case underscored words will be returned in humanized form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.humanize( 'message_properties' ); // === 'Message properties'
   *     inflection.humanize( 'message_properties', true ); // === 'message properties'
   */
    humanize : function( str, lowFirstLetter ){
      str = str.toLowerCase();
      str = str.replace( id_suffix, '' );
      str = str.replace( underbar, ' ' );

      if( !lowFirstLetter ){
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
   * This function adds dasherization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Replaces all spaces or underbars with dashes.
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
      str         = str.toLowerCase().replace( underbar, ' ');
      var str_arr = str.split(' ');
      var i       = 0;
      var j       = str_arr.length;

      for( ; i < j; i++ ){
        var d = str_arr[ i ].split( '-' );
        var k = 0;
        var l = d.length;

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
   * @param {Boolean} dropIdUbar Default is to seperate id with an underbar at the end of the class name,
                                 you can pass true to skip it.(optional)
   * @returns {String} Underscored plural nouns become the camel cased singular form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.foreign_key( 'MessageBusProperty' ); // === 'message_bus_property_id'
   *     inflection.foreign_key( 'MessageBusProperty', true ); // === 'message_bus_propertyid'
   */
    foreign_key : function( str, dropIdUbar ){
      str = inflector.demodulize( str );
      str = inflector.underscore( str ) + (( dropIdUbar ) ? ( '' ) : ( '_' )) + 'id';

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
      var str_arr = str.split(' ');
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

  if( typeof exports === 'undefined' ) return root.inflection = inflector;

/**
 * @public
 */
  inflector.version = '1.2.7';
/**
 * Exports module.
 */
  module.exports = inflector;
})( this );

},{}],"rsvp":[function(require,module,exports){
module.exports=require('psHlfu');
},{}],"psHlfu":[function(require,module,exports){
module.exports = window.RSVP;
},{}],"underscore":[function(require,module,exports){
module.exports=require('69U/Pa');
},{}],"69U/Pa":[function(require,module,exports){
module.exports = window._;
},{}]},{},[1])
(1)
});
;
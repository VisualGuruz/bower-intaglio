!function(e){"object"==typeof exports?module.exports=e():"function"==typeof define&&define.amd?define(e):"undefined"!=typeof window?window.Intaglio=e():"undefined"!=typeof global?global.Intaglio=e():"undefined"!=typeof self&&(self.Intaglio=e())}(function(){var define,module,exports;
return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var RSVP = require('rsvp');

RSVP.configure('onerror', function (error) {
	console.error(error.message);
	console.error(error.stack);
});

module.exports = {
	repositories: require('./lib/repositories'),
	ORM: require('./lib/orm'),
	wrappers: require('./lib/wrappers'),
	utils: require('./lib/utils')
};
},{"./lib/orm":4,"./lib/repositories":14,"./lib/utils":21,"./lib/wrappers":23,"rsvp":"psHlfu"}],2:[function(require,module,exports){
var utils = require('./../utils'),
	RSVP = require('rsvp'),
	_ = require('underscore');

var BaseModel = utils.Class.extend({
	_model: null,
	_repository: null,
	_logger: null,
	_wrapper: null,

	_instanceId: null,
	_originalData: null,
	_data: null,
	_events: null,
	_extensions: null,
	_isNew: true,
	_isDeleted: false,

	init: function () {
		throw new utils.Exceptions.AbstractClassException();
	},

	on: function (event, callback) {
		// Make sure object isn't deleted
		this._checkDeleted();

		if (this._events[event] === undefined)
			this._events[event] = [];

		this._events[event].push(callback);
	},

	trigger: function (event) {
		// Make sure object isn't deleted
		this._checkDeleted();

		// Do nothing if there are no events
		if (this._events[event] === undefined)
			return;

		var self = this;

		_.each(this._events[event], function (callback) {
			callback.apply(self);
		});
	},

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
				savePromise = self._repository.create(self._model, self._data);
			}
			else {
				if (self.getFieldsPendingChange().length === 0)
					return resolve(new self._wrapper(self));

				savePromise = self._repository.save(self._model, self._data);
			}

			savePromise.then(function (data) {
				self._parseData(data);

				return resolve(new self._wrapper(self));
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

				return resolve();
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
			var conditions = [];

			self._repository.reload(self._model, self._data).then(function (data) {
				self._parseData(data);
				
				return resolve(new self._wrapper(self));
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

	_checkDeleted: function () {
		if (this._isDeleted)
			throw new utils.Exceptions.DeletedModelException();
	},

	_parseData: function (data){
		var self = this;

		// Mark it as no longer new
		self._isNew = false;

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
	},

	getFieldsPendingChange: function () {
		var changes = [],
			self = this;

		_.each(this._data, function (value, key) {
			if (self._originalData[key] !== value)
				changes.push(key);
		});

		return changes;
	}
});



module.exports = BaseModel;

},{"./../utils":21,"rsvp":"psHlfu","underscore":"69U/Pa"}],3:[function(require,module,exports){
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
		this._modelSchema = orm._getModelSchema(modelName);
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
		return new this._orm._dataWrapper(new this._model(data));
	},

	find: function (id) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			if (id !== undefined) {
				if (_.isObject(id)) {
					_.each(id, function (value, key) {
						self.where(key).equals(value);
					});
				}

				else {
					self.where(self._modelSchema.getPrimaryKey()[0]).isEqual(id);
				}
			}

			self.limit(1);

			self._repository.find(self._modelSchema, self._findOptions, self._conditions).then(function (result) {
				if (result.length === 0)
					return resolve(null);

				var model = new self._model(result[0]);

				model._isNew = false;

				return resolve(new self._orm._dataWrapper(model));
			}, reject);
		});
	},

	findAll: function () {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			var query = self._repository.find(self._orm._getModelSchema(self._modelName), self._findOptions, self._conditions);

			query.then(function (result) {
				var items = [];

				_.each(result, function (data) {
					try {
						var newModel = new self._model(data);

						newModel._isNew = false;
						
						items.push(new self._orm._dataWrapper(newModel));
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
},{"./../utils":21,"./where":11,"rsvp":"psHlfu","underscore":"69U/Pa"}],4:[function(require,module,exports){
var RSVP = require('rsvp'),
	_ = require('underscore'),
	ORM = require('./orm'),
	repositories = require('../repositories');

// Base API object. Contains the pass-thrus for other parts of the orm
var api = {};

api.create = function create(options, repository, dataWrapper, loggerModule) {
	// Handle omitted options
	if (options instanceof repositories.abstract) {
		loggerModule = dataWrapper;
		dataWrapper = repository;
		repository = options;
		options = {};
	}

	return new RSVP.Promise(function (resolve, reject) {
		var newORM = new ORM(resolve, reject, options, repository, dataWrapper, loggerModule);
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
},{"../repositories":14,"./orm":5,"rsvp":"psHlfu","underscore":"69U/Pa"}],5:[function(require,module,exports){
var RSVP = require('rsvp'),
	_ = require('underscore'),
	utils = require('./../utils'),
	BaseModel= require('./basemodel'),
	Factory = require('./factory');

// ID counter to keep track of the next ID to be used when a model is instantiated
var nextId = 0;

var ORM = utils.Class.extend({
	_repository: null,
	_dataWrapper: null,
	_options: null,
	_logger: null,
	_models: null,
	_schema: null,

	init: function (resolve, reject, options, repository, dataWrapper, loggerModule) {
		var self = this;

		utils.assert('You must supply a repository to use the ORM!', repository !== undefined);

		this._repository = repository;
		this._dataWrapper = dataWrapper || require('./../wrappers').vanilla;
		this._logger = loggerModule || console;
		this._options = options;
		this._models = {};

		// Get the schema from the repository and parse it
		parseRepositorySchema(this).then(function () {
			resolve(self);
		}, reject);
	},

	factory: function (modelName) {
		utils.assert('Could not find the model `'+modelName+'`!', this._models[modelName] !== undefined);

		return new Factory(this, modelName);
	},

	extend: function (modelName, object) {
		var model = this._models[modelName];

		_.each(object, function (value) {
			utils.assert("Only functions are supported for extensions at this time.", _.isFunction(value));
		});

		this._models[modelName] = model.extend({
			_extensions: object
		});
	},

	getSchema: function () {
		return this._schema;
	},

	_getModelSchema: function (modelName) {
		utils.assert('Could not find the model `'+modelName+'`!', this._models[modelName] !== undefined);

		return this._schema.getModel(modelName);
	}
});

module.exports = ORM;


/**
 *       PRIVATE FUNCTIONS
 */

function parseRepositorySchema(orm) {
	return new RSVP.Promise(function (resolve, reject) {
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
		_model: model,
		_repository: orm._repository,
		_logger: orm._logger,
		_wrapper: orm._dataWrapper,
		
		_getClass: function () {
			return orm._models[this._model.getName()];
		},

		init: function (data) {
			var self = this;
			
			// Setup the instance vars
			this._originalData = {};
			this._data = {};
			this._events = {};
			this._conditions = [];

			// Set the instance ID for tracking
			this._instanceId = nextId;

			// Bump the next id
			nextId++;

			// Setup the fields
			_.each(this._model.getProperties(), function (property) {
				self._originalData[property.getName()] = null;
				self._data[property.getName()] = null;
			});

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
}
},{"./../utils":21,"./../wrappers":23,"./basemodel":2,"./factory":3,"rsvp":"psHlfu","underscore":"69U/Pa"}],6:[function(require,module,exports){
var utils = require('./../../utils'),
	_ = require('underscore'),
	inflection = require('inflection');

module.exports = utils.Class.extend({
	_name: null,
	_originalName: null,
	_metadata: null,

	init: function (name, metadata) {
		// Set the name of the object
		this._setName(name);

		// Store the metadata
		this._metadata = metadata || {};

		// We don't actually want to instantiate this object, as it is abstract.
		throw new utils.Exceptions.AbstractClassException();
	},

	getName: function () {
		return this._name;
	},

	getPluralizedName: function () {
		var parts = inflection.underscore(this.getName()).split('_');

		if (parts.length === 1)
			parts[0] = inflection.pluralize(parts[0]);
		else
			parts[parts.length - 1] = inflection.pluralize(parts[parts.length - 1]);

		return inflection.camelize(parts.join('_'), true);
	},

	getOriginalName: function () {
		return this._originalName;
	},

	getMetadata: function () {
		return this._metadata;
	},

	_setName: function (name) {
		utils.assert('`name` is a required field!', name !== undefined);
		utils.assert('`name` must be a string!', _.isString(name));

		this._name = utils.normalizeName(name);
		this._originalName = name;
	}
});
},{"./../../utils":21,"inflection":26,"underscore":"69U/Pa"}],7:[function(require,module,exports){
module.exports = {
	Abstract: require('./abstract'),
	Schema: require('./schema'),
	Model: require('./model'),
	Property: require('./property')
};
},{"./abstract":6,"./model":8,"./property":9,"./schema":10}],8:[function(require,module,exports){
var utils = require('./../../utils'),
	_ = require('underscore'),
	AbstractSchema = require('./abstract'),
	Property = require('./property');
	
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
		return this._properties[utils.normalizeName(name)];
	},

	getProperties: function () {
		return this._properties;
	},

	getPrimaryKey: function () {
		var keys = [];

		for (var key in this._properties) {
			if (this._properties[key].isPrimaryKey())
				keys.push(this._properties[key].getName());
		}

		return keys;
	},
	getJSON: function () {
		var schema = {
			name: this.getName(),
			properties: {}
		};

		_.each(this.getProperties(), function (property) {
			schema.properties[property.getName()] = property.getJSON();
		});

		return schema;
	}
});
},{"./../../utils":21,"./abstract":6,"./property":9,"underscore":"69U/Pa"}],9:[function(require,module,exports){
var utils = require('./../../utils'),
	AbstractSchema = require('./abstract');

module.exports = AbstractSchema.extend({
	_primaryKey: false,
	_required: false,
	_type: "String",

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

	getJSON: function () {
		return {
			name: this.getName(),
			type: this.getType(),
			primaryKey: this.isPrimaryKey(),
			required: this.isRequired()
		};
	}
});
},{"./../../utils":21,"./abstract":6}],10:[function(require,module,exports){
var utils = require('./../../utils'),
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

	getJSON: function () {
		var schema = {};

		_.each(this.getModels(), function (model) {
			schema[model.getName()] = model.getJSON();
		});

		return schema;
	}
});
},{"./../../utils":21,"./model":8,"underscore":"69U/Pa"}],11:[function(require,module,exports){
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
},{"./../utils":21,"rsvp":"psHlfu","underscore":"69U/Pa"}],12:[function(require,module,exports){
var RSVP = require('rsvp'),
	utils = require('./../../utils');

var AbstractRepository = utils.Class.extend({
	_options: null,
	_logger: null,
	_db: null,

	// Include the where functions
	where: null,

	
	init: function (options, loggerModule, driverModule) {
		throw new utils.Exceptions.AbstractClassException();
	},

	// Should return a promise interface
	getSchema: function () {
		return new RSVP.Promise(function (resolve, reject) {

		});
	},
	
	// Should return a promise interface
	find: function (model, options, conditions) {
		return new RSVP.Promise(function (resolve, reject) {

		});
	},

	// Should return a promise interface
	create: function (model, data) {
		return new RSVP.Promise(function (resolve, reject) {

		});
	},

	// Should return a promise interface
	save: function (model, data, primaryKey) {
		return new RSVP.Promise(function (resolve, reject) {

		});
	},

	// Should return a promise interface
	delete: function (model, primaryKey) {
		return new RSVP.Promise(function (resolve, reject) {

		});
	}
});

// Export the class
module.exports = AbstractRepository;
},{"./../../utils":21,"rsvp":"psHlfu"}],13:[function(require,module,exports){
var utils = require('./../../utils');

var AbstractCondition = utils.Class.extend({
	field: null,
	value: null,

	init: function (field, value) {
		this.field = field;
		this.value = value;

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
},{"./../../utils":21}],14:[function(require,module,exports){
module.exports = {
	abstract: require('./abstract/repository'),
	mysql: require('./mysql'),
	rest: require('./rest')
};
},{"./abstract/repository":12,"./mysql":25,"./rest":17}],15:[function(require,module,exports){
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
				resolve(new Response(data, xhr.status, this.logger));
			}, function (xhr, status, error) {
				reject(error);
			});
		});
	},
});

module.exports = RestJqueryDriver;
},{"./../../../utils":21,"./response":16,"rsvp":"psHlfu","underscore":"69U/Pa"}],16:[function(require,module,exports){
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
},{"./../../../utils":21}],17:[function(require,module,exports){
var _ = require('underscore'),
	RSVP = require('rsvp'),
	AbstractRepository = require('./../abstract/repository'),
	utils = require('./../../utils'),
	Schema = require('./../../orm/schema'),

	// Trickery to get browserify to pull in this file
	driver = {
		jquery: require('./driver/jquery')
	};

var REST = AbstractRepository.extend({
	// Include the where functions
	where: null,
	_schemaPromise: null,
	_driver: null,

	init: function (options, loggerModule, driverModule) {
		utils.assert('`options` must be an object!', _.isObject(options));
		utils.assert('`options` must provide a driver to use', options.driver !== undefined);

		this._options = options;
		this._logger = loggerModule || console;
		driver = driverModule || require('./driver/'+options.driver);

		this._driver = new driver(this._options, this._logger);
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

					resolve([response.data]);
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
			validateFields(model, data);

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
					if (value == 'id' && data[value] === null) {
						conditions.push(new self.where.isEqual(model.getProperty(value).getOriginalName(), result.data.id));
					}
					else
						conditions.push(new self.where.isEqual(model.getProperty(value).getOriginalName(), data[value]));
				});

				self.find(model, {}, conditions).then(function (newData) {
					return resolve(newData[0]);
				}, reject);
			}, reject);

			function validateFields(model, obj) {
				_.each(model.getProperties(), function (property) {
					if (property.isRequired())
						if ( ! _.has(obj, property.getName()) || obj[property.getName()] === null)
							throw new utils.Exceptions.ValidationException('Object missing required fields!');
				});
			}
		});
	},

	save: function (model, data) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			var dataKeys = _.keys(data),
				columns = {},
				url = '/api/'+model.getOriginalName()+'/',
				pk = null,
				conditions = [];

			// Build the where
			_.each(model.getPrimaryKey(), function (value) {
				pk = data[value];
				conditions.push(new self.where.isEqual(value, data[value]));
			});

			url+= pk;

			_.each(dataKeys, function (key) {
				if (model.getProperty(key))
					columns[model.getProperty(key).getOriginalName()] = data[key];
			});

			self._driver.post(url, columns).then(function (result) {
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
				url+= '/'+data[value];
			});

			self._driver.delete(url).then(function (result) {
				resolve(result.data);
			}, reject);
		});
	},

	reload: function (model, data) {
		var self = this;

		return new RSVP.Promise(function (resolve, reject) {
			var conditions = [];

			// Build the where
			_.each(model.getPrimaryKey(), function (value) {
				conditions.push(new self.where.isEqual(value, data[value]));
			});
			
			self.find(model, {limit: 1}, conditions).then(function (newData) {
				return resolve(newData[0]);
			}, reject);
		});
	}
});

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
		query = _.extend({}, baseQuery, queryObj);
		url = '?'+parseWhereToQueryString(query.where);

	if (query.orderBy) {
		url+='&_order='+query.orderBy;
		if (query.direction)
			url+=':'+query.direction;
	}

	if (query.limit)
		url+='&_limit='+query.limit;

	if (query.offset)
		url+='&_offset='+query.offset;

	return url;
}

function parseWhereToQueryString (whereArray) {
	var where = [];

	_.each(whereArray, function (value) {
		where.push(value.toQuery());
	});

	return where.join('&');
}
},{"./../../orm/schema":7,"./../../utils":21,"./../abstract/repository":12,"./driver/jquery":15,"./where":18,"rsvp":"psHlfu","underscore":"69U/Pa"}],18:[function(require,module,exports){
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
},{"./../../utils":21,"./../abstract/where":13,"underscore":"69U/Pa"}],19:[function(require,module,exports){
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
},{}],20:[function(require,module,exports){
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

module.exports = {
	AssertionException: AssertionException,
	ValidationException: ValidationException,
	AbstractClassException: AbstractClassException,
	DeletedModelException: DeletedModelException,
	UnsavedModelException: UnsavedModelException
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
},{}],21:[function(require,module,exports){
var api = {},
	Exceptions = require('./exceptions'),
	inflection = require('inflection');

module.exports = api;

api.assert = function (message, val) {
	if (val !== true)
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

api.normalizeName = function normalizeName (name) {
	// Clean up the name and split it up into parts
	var parts = name.replace(/(\s|\_)+/g, ' ').trim().split(' '),
		newName, word;

	// Singularize it
	if (parts.length === 1) {
		// There's only one word in the name
		parts[0] = inflection.singularize(parts[0]);
	}

	else {
		// Only singularize the last word
		word = parts.pop();

		parts.push(inflection.singularize(word));
	}

	// Recombine
	newName = parts.join('_');

	// Camelize and return
	return inflection.camelize(inflection.underscore(newName), true);
};
},{"./class":19,"./exceptions":20,"inflection":26}],22:[function(require,module,exports){
var RSVP = require('rsvp'),
	utils = require('./../utils');

var AbstractWrapper = utils.Class.extend({
	_object: null,

	init: function (object) {
		throw new utils.Exceptions.AbstractClassException();
	},

	get: function (key) {
		return this._object.get(key);
	},

	set: function (key, value) {
		return this._object.set(key, value);
	},

	on: function (event, callback) {
		return this._object.on(event, callback);
	},

	trigger: function (event) {
		return this._object.trigger(event);
	},

	save: function () {
		return this._object.save();
	},

	delete: function () {
		return this._object.delete();
	},

	reload: function () {
		return this._object.reload();
	},

	getRawData: function () {
		return this._object.getData();
	}
});

module.exports = AbstractWrapper;
},{"./../utils":21,"rsvp":"psHlfu"}],23:[function(require,module,exports){
module.exports = {
	abstract: require('./abstract'),
	vanilla: require('./vanilla')
};
},{"./abstract":22,"./vanilla":24}],24:[function(require,module,exports){
var RSVP = require('rsvp'),
	utils = require('./../utils'),
	AbstractWrapper = require('./abstract');

var VanillaWrapper = AbstractWrapper.extend({
	init: function (object) {
		this._object = object;
	}
});

module.exports = VanillaWrapper;
},{"./../utils":21,"./abstract":22,"rsvp":"psHlfu"}],25:[function(require,module,exports){

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
   *     inflection.pluralize( 'octopus' ); // === "octopi"
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
   *     inflection.singularize( 'octopi' ); // === "octopus"
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
   * @returns {String} Return all found numbers their sequence like "22nd".
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
    }
  };

  if( typeof exports === 'undefined' ) return root.inflection = inflector;

/**
 * @public
 */
  inflector.version = "1.2.5";
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
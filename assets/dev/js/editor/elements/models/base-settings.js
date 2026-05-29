var BaseSettingsModel;

/**
 * @name BaseSettingsModel
 */
BaseSettingsModel = Backbone.Model.extend( {
	options: {},

	initialize( data, options ) {
		var self = this;

		// Keep the options for cloning
		self.options = options;

		self.controls = elementor.mergeControlsSettings( options.controls );

		self.validators = {};

		if ( ! self.controls ) {
			return;
		}

		var attrs = data || {},
			defaults = {};

		_.each( self.controls, function( control ) {
			// Check features since they does not exist in tests.
			var isUIControl = control.features && -1 !== control.features.indexOf( 'ui' );

			if ( isUIControl ) {
				return;
			}
			var controlName = control.name;

			if ( 'object' === typeof control.default ) {
				defaults[ controlName ] = elementorCommon?.config?.experimentalFeatures?.e_fast_settings_clone
					? elementorCommon.helpers.cloneObject( control.default )
					: structuredClone( control.default );
			} else {
				defaults[ controlName ] = control.default;
			}

			var isDynamicControl = control.dynamic && control.dynamic.active,
				hasDynamicSettings = isDynamicControl && attrs.__dynamic__ && attrs.__dynamic__[ controlName ];

			if ( isDynamicControl && ! hasDynamicSettings && control.dynamic.default ) {
				if ( ! attrs.__dynamic__ ) {
					attrs.__dynamic__ = {};
				}

				attrs.__dynamic__[ controlName ] = control.dynamic.default;

				hasDynamicSettings = true;
			}

			// Check if the value is a plain object ( and not an array )
			var isMultipleControl = jQuery.isPlainObject( control.default );

			if ( undefined !== attrs[ controlName ] && isMultipleControl && ! _.isObject( attrs[ controlName ] ) && ! hasDynamicSettings ) {
				elementorCommon.debug.addCustomError(
					new TypeError( 'An invalid argument supplied as multiple control value' ),
					'InvalidElementData',
					'Element `' + ( self.get( 'widgetType' ) || self.get( 'elType' ) ) + '` got <' + attrs[ controlName ] + '> as `' + controlName + '` value. Expected array or object.',
				);

				delete attrs[ controlName ];
			}

			if ( undefined === attrs[ controlName ] ) {
				attrs[ controlName ] = defaults[ controlName ];
			}
		} );

		self.defaults = defaults;

		self.handleRepeaterData( attrs );

		self.set( attrs );

		if ( elementorCommon?.config?.experimentalFeatures?.e_memoize_active_controls ) {
			self.__activeControlsCacheVersion = 0;
			self.__activeControlsCache = null;
			self.on( 'change', () => {
				self.__activeControlsCacheVersion++;
				self.__activeControlsCache = null;
			} );
		}
	},

	convertRepeaterValueToCollection( attrs, repeaterControl ) {
		return new Backbone.Collection( attrs[ repeaterControl.name ], {
			model( attributes, options ) {
				options = options || {};

				options.controls = {};

				Object.values( repeaterControl.fields ).forEach( ( item ) => {
					options.controls[ item.name ] = item;
				} );

				// TODO: Cannot be deleted, since it handle repeater items after repeater widget creation.
				if ( ! attributes._id ) {
					attributes._id = elementorCommon.helpers.getUniqueId();
				}

				return new BaseSettingsModel( attributes, options );
			},
		} );
	},

	handleRepeaterData( attrs ) {
		const self = this;

		_.each( this.controls, function( field ) {
			if ( field.is_repeater ) {
				// TODO: Apply defaults on each field in repeater fields
				if ( ! ( attrs[ field.name ] instanceof Backbone.Collection ) ) {
					attrs[ field.name ] = self.convertRepeaterValueToCollection( attrs, field );
				}
			}
		} );
	},

	getFontControls() {
		return this.getControlsByType( 'font' );
	},

	getIconsControls() {
		return this.getControlsByType( 'icons' );
	},

	getControlsByType( type ) {
		return _.filter( this.getActiveControls(), ( control ) => {
			return type === control.type;
		} );
	},

	getStyleControls( controls, attributes ) {
		var self = this;

		// The inner loop replaces each control with `jQuery.extend( {}, defaults, control )`
		// before mutating it (control.styleFields = ...), so the input map is read-only here.
		// Cloning it deeply is wasted work — especially when getActiveControls is memoized
		// and returns the same cached map across calls.
		if ( elementorCommon?.config?.experimentalFeatures?.e_memoize_active_controls ) {
			controls = self.getActiveControls( controls, attributes );
		} else {
			controls = structuredClone( self.getActiveControls( controls, attributes ) );
		}

		var styleControls = [];

		jQuery.each( controls, function() {
			var control = this,
				controlDefaultSettings = elementor.config.controls[ control.type ];

			control = jQuery.extend( {}, controlDefaultSettings, control );

			if ( control.fields ) {
				var styleFields = [];

				if ( ! ( self.attributes[ control.name ] instanceof Backbone.Collection ) ) {
					self.attributes[ control.name ] = self.convertRepeaterValueToCollection( self.attributes, control );
				}

				self.attributes[ control.name ].each( function( item ) {
					styleFields.push( self.getStyleControls( control.fields, item.attributes ) );
				} );

				control.styleFields = styleFields;
			}

			if ( control.fields || ( control.dynamic?.active ) || self.isGlobalControl( control, controls ) || self.isStyleControl( control.name, controls ) ) {
				styleControls.push( control );
			}
		} );

		return styleControls;
	},

	isGlobalControl( control, controls ) {
		let controlGlobalKey = control.name;

		if ( control.groupType ) {
			controlGlobalKey = control.groupPrefix + control.groupType;
		}

		const globalControl = controls[ controlGlobalKey ];

		if ( ! globalControl?.global?.active ) {
			return false;
		}

		const globalValue = this.attributes.__globals__?.[ controlGlobalKey ];

		return !! globalValue;
	},

	isStyleControl( attribute, controls ) {
		controls = controls || this.controls;

		var currentControl = _.find( controls, function( control ) {
			return attribute === control.name;
		} );

		return currentControl && ! _.isEmpty( currentControl.selectors );
	},

	getClassControls( controls ) {
		controls = controls || this.controls;

		return _.filter( controls, function( control ) {
			return ! _.isUndefined( control.prefix_class );
		} );
	},

	isClassControl( attribute ) {
		var currentControl = _.find( this.controls, function( control ) {
			return attribute === control.name;
		} );

		return currentControl && ! _.isUndefined( currentControl.prefix_class );
	},

	getControl( id ) {
		return _.find( this.controls, function( control ) {
			return id === control.name;
		} );
	},

	getActiveControls( controls, attributes ) {
		const useCache = elementorCommon?.config?.experimentalFeatures?.e_memoize_active_controls &&
			undefined === controls &&
			undefined === attributes;

		if ( useCache && this.__activeControlsCache && this.__activeControlsCache.version === this.__activeControlsCacheVersion ) {
			return this.__activeControlsCache.result;
		}

		const activeControls = {};

		if ( ! controls ) {
			controls = this.controls;
		}

		if ( ! attributes ) {
			attributes = this.attributes;
		}

		attributes = this.parseGlobalSettings( attributes, controls );

		jQuery.each( controls, ( controlKey, control ) => {
			if ( elementor.helpers.isActiveControl( control, attributes, controls ) ) {
				activeControls[ controlKey ] = control;
			}
		} );

		if ( useCache ) {
			this.__activeControlsCache = {
				version: this.__activeControlsCacheVersion,
				result: activeControls,
			};
		}

		return activeControls;
	},

	clone() {
		return new BaseSettingsModel( elementorCommon.helpers.cloneObject( this.attributes ), elementorCommon.helpers.cloneObject( this.options ) );
	},

	setExternalChange( key, value ) {
		var self = this,
			settingsToChange;

		if ( 'object' === typeof key ) {
			settingsToChange = key;
		} else {
			settingsToChange = {};

			settingsToChange[ key ] = value;
		}

		self.set( settingsToChange );

		jQuery.each( settingsToChange, function( changedKey, changedValue ) {
			self.trigger( 'change:external:' + changedKey, changedValue );
		} );
	},

	parseDynamicSettings( settings, options, controls ) {
		var self = this;

		// Fast path: widgets without any __dynamic__ values and without repeater controls
		// have nothing to parse, so we can skip the full cloneObject pass. All existing
		// callers (views/base.js:959, controls-css-parser.js:42, repeater-row.js:80) read
		// the result without mutating it.
		if ( elementorCommon?.config?.experimentalFeatures?.e_memoize_active_controls &&
			undefined === settings && undefined === options && undefined === controls ) {
			if ( undefined === self.__hasRepeaterControl ) {
				self.__hasRepeaterControl = false;
				jQuery.each( self.controls, function() {
					if ( this.is_repeater ) {
						self.__hasRepeaterControl = true;
						return false;
					}
				} );
			}
			const dyn = self.attributes.__dynamic__;
			const hasDynamic = dyn && Object.keys( dyn ).length > 0;
			if ( ! hasDynamic && ! self.__hasRepeaterControl ) {
				return self.attributes;
			}
		}

		settings = elementorCommon.helpers.cloneObject( settings || self.attributes );

		options = options || {};

		controls = controls || this.controls;

		jQuery.each( controls, function() {
			var control = this,
				valueToParse;

			if ( control.is_repeater ) {
				valueToParse = settings[ control.name ];
				valueToParse.forEach( function( value, key ) {
					valueToParse[ key ] = self.parseDynamicSettings( value, options, control.fields );
				} );

				return;
			}

			valueToParse = settings.__dynamic__ && settings.__dynamic__[ control.name ];

			if ( ! valueToParse ) {
				return;
			}

			var dynamicSettings = control.dynamic;

			if ( undefined === dynamicSettings ) {
				dynamicSettings = elementor.config.controls[ control.type ].dynamic;
			}

			if ( ! dynamicSettings || ! dynamicSettings.active ) {
				return;
			}

			var dynamicValue;

			try {
				dynamicValue = elementor.dynamicTags.parseTagsText( valueToParse, dynamicSettings, elementor.dynamicTags.getTagDataContent );
			} catch ( error ) {
				if ( elementor.dynamicTags.CACHE_KEY_NOT_FOUND_ERROR !== error.message ) {
					throw error;
				}

				dynamicValue = '';

				if ( options.onServerRequestStart ) {
					options.onServerRequestStart();
				}

				elementor.dynamicTags.refreshCacheFromServer( function() {
					if ( options.onServerRequestEnd ) {
						options.onServerRequestEnd();
					}
				} );
			}

			if ( dynamicSettings.property ) {
				settings[ control.name ][ dynamicSettings.property ] = dynamicValue;
			} else {
				settings[ control.name ] = dynamicValue;
			}
		} );

		return settings;
	},

	parseGlobalSettings( settings, controls ) {
		settings = elementorCommon.helpers.cloneObject( settings );

		controls = controls || this.controls;

		jQuery.each( controls, ( index, control ) => {
			let valueToParse;

			if ( control.is_repeater ) {
				valueToParse = settings[ control.name ];

				valueToParse.forEach( ( value, key ) => {
					valueToParse[ key ] = this.parseGlobalSettings( value, control.fields );
				} );

				return;
			}

			valueToParse = settings.__globals__?.[ control.name ];

			if ( ! valueToParse ) {
				return;
			}

			let globalSettings = control.global;

			if ( undefined === globalSettings ) {
				globalSettings = elementor.config.controls[ control.type ].global;
			}

			if ( ! globalSettings?.active ) {
				return;
			}

			const { command, args } = $e.data.commandExtractArgs( valueToParse ),
				globalValue = $e.data.getCache( $e.components.get( 'globals' ), command, args.query );

			if ( control.groupType ) {
				settings[ control.name ] = 'custom';
			} else {
				settings[ control.name ] = globalValue;
			}
		} );

		return settings;
	},

	removeDataDefaults( data, controls ) {
		jQuery.each( data, ( key ) => {
			const control = controls[ key ];

			if ( ! control ) {
				return;
			}

			// TODO: use `save_default` in text|textarea controls.
			if ( control.save_default || ( ( 'text' === control.type || 'textarea' === control.type ) && data[ key ] ) ) {
				return;
			}

			if ( control.is_repeater ) {
				data[ key ].forEach( ( repeaterRow ) => {
					this.removeDataDefaults( repeaterRow, control.fields );
				} );

				return;
			}

			if ( _.isEqual( data[ key ], control.default ) ) {
				delete data[ key ];
			}
		} );
	},

	toJSON( options ) {
		var data = Backbone.Model.prototype.toJSON.call( this );

		options = options || {};

		delete data.widgetType;
		delete data.elType;
		delete data.isInner;

		_.each( data, function( attribute, key ) {
			if ( attribute && attribute.toJSON ) {
				data[ key ] = attribute.toJSON();
			}
		} );

		if ( options.remove && -1 !== options.remove.indexOf( 'default' ) ) {
			this.removeDataDefaults( data, this.controls );
		}

		// Element settings are plain JSON-compat data — bespoke cloner is ~5.75x faster
		// than structuredClone on this shape. Live profile flagged toJSON as the #1
		// remaining hot-spot after wp-polyfill was removed (548ms self-time).
		if ( elementorCommon?.config?.experimentalFeatures?.e_fast_settings_clone ) {
			return elementorCommon.helpers.cloneObject( data );
		}

		return structuredClone( data );
	},
} );

/**
 * @name BaseSettingsModel
 */
module.exports = BaseSettingsModel;

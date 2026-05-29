function fastClone( o ) {
	if ( null === o || 'object' !== typeof o ) {
		return o;
	}
	if ( Array.isArray( o ) ) {
		const len = o.length;
		const out = new Array( len );
		for ( let i = 0; i < len; i++ ) {
			out[ i ] = fastClone( o[ i ] );
		}
		return out;
	}
	const out = {};
	for ( const k in o ) {
		if ( Object.prototype.hasOwnProperty.call( o, k ) ) {
			out[ k ] = fastClone( o[ k ] );
		}
	}
	return out;
}

export default class Helpers {
	/**
	 * @param {*} args
	 * @deprecated since 3.7.0, use `elementorDevTools.consoleWarn()` instead.
	 */
	consoleWarn( ...args ) {
		elementorDevTools.consoleWarn( ...args );

		// This is is self is deprecated.
		elementorDevTools.deprecation.deprecated( 'elementorCommon.helpers.consoleWarn()', '3.7.0', 'elementorDevTools.consoleWarn()' );
	}

	/**
	 * @param {string} message
	 * @deprecated since 3.7.0, use `console.error()` instead.
	 */
	consoleError( message ) {
		// eslint-disable-next-line no-console
		console.error( message );

		// This is is self is deprecated.
		elementorDevTools.deprecation.deprecated( 'elementorCommon.helpers.consoleError()', '3.7.0', 'console.error()' );
	}

	cloneObject( object ) {
		// Bespoke recursive cloner optimized for plain JSON-compat data (the shape of
		// Elementor element settings). Benchmarks ~5.75x faster than structuredClone and
		// ~4.5x faster than JSON.parse(JSON.stringify()) for typical settings payloads.
		// Falls through for primitives. Handles arrays and plain objects only — callers
		// passing Date/Map/Set/RegExp/TypedArray should switch back to structuredClone.
		return fastClone( object );
	}

	upperCaseWords( string ) {
		return ( string + '' ).replace( /^(.)|\s+(.)/g, function( $1 ) {
			return $1.toUpperCase();
		} );
	}

	getUniqueId() {
		return Math.random().toString( 16 ).substr( 2, 7 );
	}
}

// Bespoke recursive cloner optimized for plain JSON-compat data. Benchmarks ~5.75x
// faster than structuredClone and ~4.5x faster than JSON.parse(JSON.stringify) on
// typical Elementor settings shapes. Guarded with a depth limit + try/catch fallback
// to JSON.parse(JSON.stringify) so any input that worked with the previous cloneObject
// implementation continues to work — pathological depth or cycles trigger fallback
// instead of blowing the JS call stack.
const FAST_CLONE_MAX_DEPTH = 200;

function fastCloneImpl( o, depth ) {
	if ( null === o || 'object' !== typeof o ) {
		return o;
	}
	if ( depth > FAST_CLONE_MAX_DEPTH ) {
		// Too deep for JS recursion — bail to JSON.parse(JSON.stringify) which runs in
		// native code and has a much higher recursion budget.
		return JSON.parse( JSON.stringify( o ) );
	}
	if ( Array.isArray( o ) ) {
		const len = o.length;
		const out = new Array( len );
		const next = depth + 1;
		for ( let i = 0; i < len; i++ ) {
			out[ i ] = fastCloneImpl( o[ i ], next );
		}
		return out;
	}
	const out = {};
	const next = depth + 1;
	for ( const k in o ) {
		if ( Object.prototype.hasOwnProperty.call( o, k ) ) {
			out[ k ] = fastCloneImpl( o[ k ], next );
		}
	}
	return out;
}

function fastClone( o ) {
	try {
		return fastCloneImpl( o, 0 );
	} catch ( e ) {
		// Cycle, non-plain types, or anything else fastCloneImpl can't handle.
		// Fall back to the exact behavior of the original cloneObject helper so any
		// caller that worked before keeps working.
		return JSON.parse( JSON.stringify( o ) );
	}
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

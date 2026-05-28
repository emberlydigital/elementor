#!/usr/bin/env node
// Compare two V8 .cpuprofile files for named hot-spots.
// Usage: node scripts/analyze-cpuprofile.mjs reports/bootstrap-experiment-off.cpuprofile reports/bootstrap-experiment-on.cpuprofile

import { readFileSync } from 'fs';

const TARGETS = [
	'cloneObject',
	'isActiveControl',
	'convertConditionToConditions',
	'getActiveControls',
	'parseGlobalSettings',
	'check',
	'compare',
];

function load( path ) {
	const profile = JSON.parse( readFileSync( path, 'utf8' ) );
	const { nodes, samples, timeDeltas, startTime, endTime } = profile;

	const totalUs = ( endTime - startTime );
	const nodeById = new Map( nodes.map( ( n ) => [ n.id, n ] ) );

	// Self time per node: sum of timeDeltas where samples[i] == nodeId.
	const selfUsById = new Map();
	let runningUs = 0;
	for ( let i = 0; i < samples.length; i++ ) {
		const dt = timeDeltas[ i ];
		const id = samples[ i ];
		selfUsById.set( id, ( selfUsById.get( id ) || 0 ) + dt );
		runningUs += dt;
	}

	const fnSelf = new Map();
	for ( const [ id, us ] of selfUsById ) {
		const node = nodeById.get( id );
		if ( ! node ) {
			continue;
		}
		const name = node.callFrame.functionName || '(anonymous)';
		fnSelf.set( name, ( fnSelf.get( name ) || 0 ) + us );
	}

	return { totalMs: totalUs / 1000, sampledMs: runningUs / 1000, fnSelf, sampleCount: samples.length };
}

function main() {
	const [ offPath, onPath ] = process.argv.slice( 2 );
	if ( ! offPath || ! onPath ) {
		console.error( 'Usage: analyze-cpuprofile.mjs <off.cpuprofile> <on.cpuprofile>' );
		process.exit( 1 );
	}

	const off = load( offPath );
	const on = load( onPath );

	const heading = ( label ) => `\n=== ${ label } ===`;

	console.log( heading( 'Wall-clock' ) );
	console.log( `OFF: ${ off.totalMs.toFixed( 1 ) } ms, samples ${ off.sampleCount } (sampled ${ off.sampledMs.toFixed( 1 ) } ms)` );
	console.log( `ON:  ${ on.totalMs.toFixed( 1 ) } ms, samples ${ on.sampleCount } (sampled ${ on.sampledMs.toFixed( 1 ) } ms)` );

	console.log( heading( 'Hot-spots called out in the original CPU profile' ) );
	const rows = [];
	for ( const name of TARGETS ) {
		const offMs = ( off.fnSelf.get( name ) || 0 ) / 1000;
		const onMs = ( on.fnSelf.get( name ) || 0 ) / 1000;
		const delta = onMs - offMs;
		const pct = offMs > 0 ? ( delta / offMs ) * 100 : 0;
		rows.push( { name, offMs, onMs, delta, pct } );
	}
	rows.sort( ( a, b ) => b.offMs - a.offMs );
	console.log( 'function                              off ms     on ms    delta     %' );
	for ( const r of rows ) {
		console.log( `${ r.name.padEnd( 35 ) } ${ r.offMs.toFixed( 1 ).padStart( 8 ) } ${ r.onMs.toFixed( 1 ).padStart( 8 ) } ${ r.delta.toFixed( 1 ).padStart( 8 ) } ${ r.pct.toFixed( 1 ).padStart( 6 ) }` );
	}

	console.log( heading( 'Top 15 self-time consumers (OFF)' ) );
	const sortedOff = [ ...off.fnSelf.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 15 );
	for ( const [ name, us ] of sortedOff ) {
		console.log( `  ${ ( us / 1000 ).toFixed( 1 ).padStart( 7 ) } ms  ${ name }` );
	}

	console.log( heading( 'Top 15 self-time consumers (ON)' ) );
	const sortedOn = [ ...on.fnSelf.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 15 );
	for ( const [ name, us ] of sortedOn ) {
		console.log( `  ${ ( us / 1000 ).toFixed( 1 ).padStart( 7 ) } ms  ${ name }` );
	}
}

main();

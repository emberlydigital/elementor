import { chromium } from 'playwright';
import fs from 'node:fs';

const SITE = 'https://omsimgtrendstg.wpenginepowered.com';
const WP_USER = process.env.wpusername;
const WP_PASS = process.env.wppassword;
const BASIC_USER = process.env.browserusername;
const BASIC_PASS = process.env.browserpassword;
const POST_ID = process.env.POST_ID || '15479';
const OUT = process.env.OUT || 'reports/staging-editor.cpuprofile';

async function run() {
	const browser = await chromium.launch( {
		headless: true,
		args: [ '--js-flags=--no-flush-bytecode' ],
	} );
	const context = await browser.newContext( {
		httpCredentials: { username: BASIC_USER, password: BASIC_PASS },
		ignoreHTTPSErrors: true,
		viewport: { width: 1440, height: 900 },
	} );
	const page = await context.newPage();

	console.log( '[1/3] login' );
	await page.goto( `${ SITE }/getwplogin`, { timeout: 60000, waitUntil: 'domcontentloaded' } );
	await page.fill( '#user_login', WP_USER );
	await page.fill( '#user_pass', WP_PASS );
	await Promise.all( [
		page.waitForURL( /\/wp-admin\/|\/?\/?dashboard/, { timeout: 60000 } ).catch( () => {} ),
		page.click( '#wp-submit' ),
	] );
	console.log( '  logged in, url:', page.url() );

	console.log( '[2/3] start CPU profile + navigate to editor' );
	const cdp = await page.context().newCDPSession( page );
	await cdp.send( 'Profiler.enable' );
	await cdp.send( 'Profiler.setSamplingInterval', { interval: 1000 } );
	await cdp.send( 'Profiler.start' );

	const editorUrl = `${ SITE }/wp-admin/post.php?post=${ POST_ID }&action=elementor`;
	const t0 = Date.now();
	await page.goto( editorUrl, { timeout: 180000, waitUntil: 'commit' } );
	try {
		await page.waitForFunction( () => {
			const w = window;
			return Boolean( w.elementor?.loaded );
		}, { timeout: 240000 } );
		const ready = Date.now() - t0;
		console.log( `  elementor.loaded at ${ ready }ms` );
		// Give post-load work time to settle in the profile
		await page.waitForTimeout( 3000 );
	} catch ( e ) {
		console.log( '  loaded wait timed out; capturing what we have' );
	}

	console.log( '[3/3] stop profile' );
	const result = await cdp.send( 'Profiler.stop' );
	fs.mkdirSync( 'reports', { recursive: true } );
	fs.writeFileSync( OUT, JSON.stringify( result.profile ) );
	console.log( `  -> ${ OUT } (${ ( fs.statSync( OUT ).size / 1024 ).toFixed( 0 ) } KB)` );

	// Element count
	try {
		const previewFrame = page.frames().find( ( f ) => f.url().includes( 'preview' ) || f.url().includes( 'post.php' ) );
		const elementCount = await page.evaluate( () => {
			const iframe = document.getElementById( 'elementor-preview-iframe' );
			return iframe?.contentDocument?.querySelectorAll( '.elementor-element' ).length ?? -1;
		} );
		console.log( `  element count: ${ elementCount }` );
	} catch {}

	await browser.close();
}

run().catch( ( e ) => { console.error( e ); process.exit( 1 ); } );

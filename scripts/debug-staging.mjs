import { chromium } from 'playwright';

const SITE = 'https://omsimgtrendstg.wpenginepowered.com';
const BASIC_USER = process.env.browserusername;
const BASIC_PASS = process.env.browserpassword;

const browser = await chromium.launch( { headless: true } );
const ctx = await browser.newContext( {
	httpCredentials: { username: BASIC_USER, password: BASIC_PASS },
	ignoreHTTPSErrors: true,
} );
const page = await ctx.newPage();

// Fetch homepage and look for login/account links
console.log( 'homepage:' );
await page.goto( `${ SITE }/`, { timeout: 30000, waitUntil: 'domcontentloaded' } );
const links = await page.evaluate( () => {
	return [ ...document.querySelectorAll( 'a[href]' ) ]
		.map( ( a ) => a.href )
		.filter( ( h ) => /login|signin|admin|account|portal|dash|user|control|wpe/i.test( h ) )
		.slice( 0, 20 );
} );
console.log( '  candidate login links:', links );

// Try robots.txt for hints
const r = await page.goto( `${ SITE }/robots.txt`, { timeout: 10000 } ).catch( () => null );
if ( r && r.status() === 200 ) {
	console.log( 'robots.txt:' );
	console.log( ( await page.content() ).slice( 0, 800 ) );
}

await browser.close();

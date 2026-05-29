import { expect, CDPSession, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parallelTest as test } from '../parallelTest';
import WpAdminPage from '../pages/wp-admin-page';
import EditorPage from '../pages/editor-page';

const HEAVY_WIDGETS: string[] = [
	'heading', 'text-editor', 'image', 'button', 'icon',
	'icon-box', 'image-box', 'star-rating', 'divider', 'spacer',
	'image-gallery', 'icon-list', 'counter', 'progress', 'tabs',
	'toggle', 'alert', 'html', 'shortcode', 'menu-anchor',
];

const REPEATS_PER_WIDGET = 4;

async function buildHeavyPage( editor: EditorPage ): Promise<number> {
	const container = await editor.addElement( { elType: 'container' }, 'document' );
	let count = 0;
	for ( const widgetType of HEAVY_WIDGETS ) {
		for ( let i = 0; i < REPEATS_PER_WIDGET; i++ ) {
			try {
				await editor.addElement( { widgetType, elType: 'widget' }, container );
				count++;
			} catch {
				// Widget not registered in this install — skip.
			}
		}
	}
	return count;
}

async function captureProfile( page: Page, postId: string, outFile: string ): Promise<number> {
	const client: CDPSession = await page.context().newCDPSession( page );
	await client.send( 'Profiler.enable' );
	await client.send( 'Profiler.start' );

	const start = Date.now();
	await page.goto( `/wp-admin/post.php?post=${ postId }&action=elementor` );
	await page.waitForFunction(
		() => Boolean( ( window as unknown as { elementor?: { loaded?: boolean } } ).elementor?.loaded ),
		{ timeout: 120_000 },
	);
	const elapsed = Date.now() - start;

	const { profile } = await client.send( 'Profiler.stop' );
	await client.detach();

	mkdirSync( resolve( __dirname, '../../../reports' ), { recursive: true } );
	writeFileSync( outFile, JSON.stringify( profile ) );

	return elapsed;
}

test.describe( 'Editor bootstrap CPU profile', () => {
	test.describe.configure( { timeout: 600_000 } );

	test( 'capture before/after profiles for e_memoize_active_controls', async ( { page, apiRequests }, testInfo ) => {
		const wpAdmin = new WpAdminPage( page, testInfo, apiRequests );

		await wpAdmin.setExperiments( { e_memoize_active_controls: false } );
		const editor = await wpAdmin.openNewPage();

		const widgetsAdded = await buildHeavyPage( editor );
		expect( widgetsAdded ).toBeGreaterThan( 0 );
		await editor.saveAndReloadPage();

		const url = new URL( page.url() );
		const postId = url.searchParams.get( 'post' );
		if ( ! postId ) {
			throw new Error( `Could not extract post id from URL: ${ page.url() }` );
		}

		const outDir = resolve( __dirname, '../../../reports' );
		const offFile = resolve( outDir, `bootstrap-experiment-off.cpuprofile` );
		const onFile = resolve( outDir, `bootstrap-experiment-on.cpuprofile` );

		const offElapsed = await captureProfile( page, postId, offFile );

		await wpAdmin.setExperiments( { e_memoize_active_controls: true } );

		const onElapsed = await captureProfile( page, postId, onFile );

		testInfo.annotations.push(
			{ type: 'cpu-profile', description: `OFF: ${ offElapsed } ms — saved to ${ offFile }` },
			{ type: 'cpu-profile', description: `ON:  ${ onElapsed } ms — saved to ${ onFile }` },
		);

		await wpAdmin.resetExperiments();
	} );
} );

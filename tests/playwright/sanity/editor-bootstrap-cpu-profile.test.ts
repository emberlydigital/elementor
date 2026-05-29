import { CDPSession, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parallelTest as test } from '../parallelTest';
import WpAdminPage from '../pages/wp-admin-page';
import EditorPage from '../pages/editor-page';

const HEAVY_WIDGETS: string[] = [
	'heading', 'text-editor', 'image', 'button', 'icon',
	'icon-box', 'image-box', 'star-rating', 'divider', 'spacer',
	'icon-list', 'counter', 'progress', 'tabs', 'toggle',
	'alert', 'html', 'shortcode', 'menu-anchor', 'image-carousel',
];

const REPEATS_PER_WIDGET = 10;
const GOTO_TIMEOUT_MS = 120_000;
const READY_TIMEOUT_MS = 180_000;

async function buildHeavyPage( editor: EditorPage ): Promise<number> {
	const container = await editor.addElement( { elType: 'container' }, 'document' );
	let count = 0;
	for ( const widgetType of HEAVY_WIDGETS ) {
		for ( let i = 0; i < REPEATS_PER_WIDGET; i++ ) {
			try {
				await editor.addElement( { widgetType, elType: 'widget' }, container );
				count++;
			} catch {
				// Widget not registered in this install — skip; we just need volume.
			}
		}
	}
	return count;
}

async function openEditorAndWait( page: Page, postId: string ): Promise<number> {
	const start = Date.now();
	await page.goto( `/wp-admin/post.php?post=${ postId }&action=elementor`, { timeout: GOTO_TIMEOUT_MS } );
	await page.waitForFunction(
		() => Boolean( ( window as unknown as { elementor?: { loaded?: boolean } } ).elementor?.loaded ),
		{ timeout: READY_TIMEOUT_MS },
	);
	await page.waitForSelector( '#elementor-panel-header-title', { state: 'visible', timeout: READY_TIMEOUT_MS } );
	return Date.now() - start;
}

async function captureProfile( page: Page, postId: string, outFile: string ): Promise<number> {
	const client: CDPSession = await page.context().newCDPSession( page );
	await client.send( 'Profiler.enable' );
	await client.send( 'Profiler.start' );

	const elapsed = await openEditorAndWait( page, postId );

	const { profile } = await client.send( 'Profiler.stop' );
	await client.detach();

	writeFileSync( outFile, JSON.stringify( profile ) );
	return elapsed;
}

test.describe( 'Editor bootstrap CPU profile', () => {
	test.describe.configure( { timeout: 1_800_000 } );
	test.use( { navigationTimeout: 180_000, actionTimeout: 60_000 } );

	test( 'capture before/after profiles for e_memoize_active_controls', async ( { page, apiRequests }, testInfo ) => {
		const wpAdmin = new WpAdminPage( page, testInfo, apiRequests );

		const request = page.context().request;
		const postId = await apiRequests.create( request, 'pages', { title: 'Editor bootstrap CPU profile', content: '' } );

		await openEditorAndWait( page, postId );
		const editor = new EditorPage( page, testInfo );
		await buildHeavyPage( editor );
		await page.evaluate( async () => {
			await $e.run( 'document/save/update' );
		} );

		const outDir = resolve( __dirname, '../../../reports' );
		mkdirSync( outDir, { recursive: true } );
		const offFile = resolve( outDir, 'bootstrap-experiment-off.cpuprofile' );
		const onFile = resolve( outDir, 'bootstrap-experiment-on.cpuprofile' );

		const offElapsed = await captureProfile( page, postId, offFile );

		await wpAdmin.setExperiments( { e_memoize_active_controls: true } );

		const onElapsed = await captureProfile( page, postId, onFile );

		// eslint-disable-next-line no-console
		console.log( `[cpu-profile] off=${ offElapsed }ms -> ${ offFile }; on=${ onElapsed }ms -> ${ onFile }` );

		testInfo.annotations.push(
			{ type: 'cpu-profile', description: `OFF: ${ offElapsed } ms — ${ offFile }` },
			{ type: 'cpu-profile', description: `ON:  ${ onElapsed } ms — ${ onFile }` },
		);
	} );
} );

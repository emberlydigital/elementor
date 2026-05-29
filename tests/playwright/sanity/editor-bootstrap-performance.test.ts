import { expect, Page } from '@playwright/test';
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
const RUNS_PER_CONDITION = 3;
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
		() => {
			const w = window as unknown as { elementor?: { loaded?: boolean } };
			return Boolean( w.elementor?.loaded );
		},
		{ timeout: READY_TIMEOUT_MS },
	);
	await page.waitForSelector( '#elementor-panel-header-title', { state: 'visible', timeout: READY_TIMEOUT_MS } );
	return Date.now() - start;
}

test.describe( 'Editor bootstrap performance', () => {
	test.describe.configure( { timeout: 1_800_000 } );
	test.use( { navigationTimeout: 180_000, actionTimeout: 60_000 } );

	test( 'memoize_active_controls does not regress editor load and preserves rendering', async ( { page, apiRequests }, testInfo ) => {
		const wpAdmin = new WpAdminPage( page, testInfo, apiRequests );

		const request = page.context().request;
		const postId = await apiRequests.create( request, 'pages', { title: 'Editor bootstrap perf', content: '' } );

		await openEditorAndWait( page, postId );
		const editor = new EditorPage( page, testInfo );

		const widgetsAdded = await buildHeavyPage( editor );
		expect( widgetsAdded ).toBeGreaterThan( 0 );
		await page.evaluate( async () => {
			await $e.run( 'document/save/update' );
		} );

		const offRuns: number[] = [];
		for ( let i = 0; i < RUNS_PER_CONDITION; i++ ) {
			offRuns.push( await openEditorAndWait( page, postId ) );
		}
		const offElementCount = await editor.getPreviewFrame().locator( '.elementor-element' ).count();

		await wpAdmin.setExperiments( { e_memoize_active_controls: true } );

		const onRuns: number[] = [];
		for ( let i = 0; i < RUNS_PER_CONDITION; i++ ) {
			onRuns.push( await openEditorAndWait( page, postId ) );
		}
		const onElementCount = await editor.getPreviewFrame().locator( '.elementor-element' ).count();

		const median = ( arr: number[] ): number => {
			const sorted = [ ...arr ].sort( ( a, b ) => a - b );
			return sorted[ Math.floor( sorted.length / 2 ) ];
		};
		const offMedian = median( offRuns );
		const onMedian = median( onRuns );

		// eslint-disable-next-line no-console
		console.log( `[editor-bootstrap-perf] widgets=${ widgetsAdded } off=${ offRuns.join( ',' ) } (median ${ offMedian }) on=${ onRuns.join( ',' ) } (median ${ onMedian }) elements off=${ offElementCount } on=${ onElementCount }` );

		testInfo.annotations.push(
			{ type: 'bootstrap', description: `widgets added: ${ widgetsAdded }` },
			{ type: 'bootstrap', description: `experiment OFF: ${ offRuns.join( ', ' ) } ms (median ${ offMedian } ms)` },
			{ type: 'bootstrap', description: `experiment ON:  ${ onRuns.join( ', ' ) } ms (median ${ onMedian } ms)` },
			{ type: 'bootstrap', description: `element count OFF=${ offElementCount } ON=${ onElementCount }` },
		);

		expect( onElementCount ).toBe( offElementCount );

		expect( onMedian ).toBeLessThan( offMedian * 1.15 );
	} );
} );

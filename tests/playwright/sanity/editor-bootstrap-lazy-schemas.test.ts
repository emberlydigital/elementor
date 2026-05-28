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

const REPEATS_PER_WIDGET = 2;
const RUNS_PER_CONDITION = 3;
const GOTO_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 240_000;

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

interface PayloadStats {
	configBytes: number;
	widgetsCount: number;
	lazyCount: number;
	usedTypes: string[];
}

async function inspectPayload( page: Page ): Promise<PayloadStats> {
	return await page.evaluate( () => {
		const e = ( window as unknown as { elementor?: { widgetsCache?: Record<string, { controls?: object; lazy?: boolean }>; config?: { document?: { elements?: Array<{ widgetType?: string; elements?: unknown[] }> } } } } ).elementor;
		const cache = e?.widgetsCache || {};
		const widgetsCount = Object.keys( cache ).length;
		let lazyCount = 0;
		for ( const key of Object.keys( cache ) ) {
			if ( cache[ key ]?.lazy ) {
				lazyCount++;
			}
		}
		const used = new Set<string>();
		const walk = ( els: Array<{ widgetType?: string; elements?: unknown[] }> ) => {
			for ( const el of els ) {
				if ( el.widgetType ) {
					used.add( el.widgetType );
				}
				if ( Array.isArray( el.elements ) ) {
					walk( el.elements as Array<{ widgetType?: string; elements?: unknown[] }> );
				}
			}
		};
		walk( e?.config?.document?.elements || [] );
		return {
			configBytes: JSON.stringify( cache ).length,
			widgetsCount,
			lazyCount,
			usedTypes: Array.from( used ).sort(),
		};
	} );
}

test.describe( 'Editor bootstrap — lazy widget schemas', () => {
	test.describe.configure( { timeout: 1_800_000 } );
	test.use( { navigationTimeout: 240_000, actionTimeout: 60_000 } );

	test( 'e_lazy_widget_schemas shrinks initial widget config payload without breaking rendering', async ( { page, apiRequests }, testInfo ) => {
		const wpAdmin = new WpAdminPage( page, testInfo, apiRequests );

		const request = page.context().request;
		const postId = await apiRequests.create( request, 'pages', { title: 'Editor bootstrap lazy schemas', content: '' } );

		await openEditorAndWait( page, postId );
		const editor = new EditorPage( page, testInfo );
		const widgetsAdded = await buildHeavyPage( editor );
		expect( widgetsAdded ).toBeGreaterThan( 0 );
		await page.evaluate( async () => {
			await $e.run( 'document/save/update' );
		} );

		// Experiment OFF
		const offRuns: number[] = [];
		for ( let i = 0; i < RUNS_PER_CONDITION; i++ ) {
			offRuns.push( await openEditorAndWait( page, postId ) );
		}
		const offPayload = await inspectPayload( page );
		const offElementCount = await editor.getPreviewFrame().locator( '.elementor-element' ).count();

		// Experiment ON
		await wpAdmin.setExperiments( { e_lazy_widget_schemas: true } );

		const onRuns: number[] = [];
		for ( let i = 0; i < RUNS_PER_CONDITION; i++ ) {
			onRuns.push( await openEditorAndWait( page, postId ) );
		}
		const onPayload = await inspectPayload( page );
		const onElementCount = await editor.getPreviewFrame().locator( '.elementor-element' ).count();

		const median = ( arr: number[] ): number => {
			const sorted = [ ...arr ].sort( ( a, b ) => a - b );
			return sorted[ Math.floor( sorted.length / 2 ) ];
		};
		const offMedian = median( offRuns );
		const onMedian = median( onRuns );

		// eslint-disable-next-line no-console
		console.log( `[lazy-schemas] widgets=${ widgetsAdded } off=${ offRuns.join( ',' ) } (median ${ offMedian }ms) on=${ onRuns.join( ',' ) } (median ${ onMedian }ms) | off bytes=${ offPayload.configBytes }, lazy=${ offPayload.lazyCount }/${ offPayload.widgetsCount } | on bytes=${ onPayload.configBytes }, lazy=${ onPayload.lazyCount }/${ onPayload.widgetsCount }` );

		testInfo.annotations.push(
			{ type: 'lazy-schemas', description: `widgets on page: ${ widgetsAdded }; unique used types: ${ offPayload.usedTypes.length }` },
			{ type: 'lazy-schemas', description: `OFF runs: ${ offRuns.join( ', ' ) } ms (median ${ offMedian }), payload ${ ( offPayload.configBytes / 1024 ).toFixed( 1 ) } KB, ${ offPayload.lazyCount }/${ offPayload.widgetsCount } lazy` },
			{ type: 'lazy-schemas', description: `ON runs:  ${ onRuns.join( ', ' ) } ms (median ${ onMedian }), payload ${ ( onPayload.configBytes / 1024 ).toFixed( 1 ) } KB, ${ onPayload.lazyCount }/${ onPayload.widgetsCount } lazy` },
		);

		// Correctness: same rendered elements either way.
		expect( onElementCount ).toBe( offElementCount );

		// Correctness: with the experiment on, some widget types are lazy-stripped
		// (the boot payload contains more types than the page uses).
		expect( onPayload.lazyCount ).toBeGreaterThan( 0 );
		expect( offPayload.lazyCount ).toBe( 0 );

		// At minimum we should not regress wall-clock beyond a generous 25% budget
		// (the AJAX-deferred schema fetch can offset some of the parse savings).
		expect( onMedian ).toBeLessThan( offMedian * 1.25 );
	} );
} );

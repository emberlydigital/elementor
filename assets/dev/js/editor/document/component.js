import ComponentBase from 'elementor-api/modules/component-base';

import * as components from './';
import * as hooks from './hooks/';
import * as uiStates from './ui-states';

export default class Component extends ComponentBase {
	getNamespace() {
		return 'document';
	}

	registerAPI() {
		Object.values( components ).forEach( ( ComponentClass ) =>
			$e.components.register( new ComponentClass ),
		);

		super.registerAPI();
	}

	defaultCommands() {
		return {
			// Example: ( args ) => ( new Commands.Example( args ).run() ),
		};
	}

	defaultHooks() {
		return this.importHooks( hooks );
	}

	defaultUiStates() {
		return this.importUiStates( uiStates );
	}

	defaultUtils() {
		const findViewRecursive = ( parent, key, value, multiple = true ) => {
			let found = [];
			for ( const x in parent._views ) {
				const view = parent._views[ x ];

				if ( value === view.model.get( key ) ) {
					found.push( view );
					if ( ! multiple ) {
						return found;
					}
				}

				if ( view.children ) {
					const views = findViewRecursive( view.children, key, value, multiple );
					if ( views.length ) {
						found = found.concat( views );
						if ( ! multiple ) {
							return found;
						}
					}
				}
			}

			return found;
		};

		// Per-frame index for findViewById. Without this, each lookup is an O(n) tree
		// walk; with hundreds of lookups during boot on a heavy page (200+ elements),
		// the cumulative cost reached ~500ms self-time in findViewRecursive.
		// Gated by e_memoize_active_controls.
		let viewIndex = null;
		let viewIndexScheduled = false;

		const buildViewIndex = () => {
			const index = new Map();
			const walk = ( children ) => {
				if ( ! children?._views ) {
					return;
				}
				for ( const k in children._views ) {
					const view = children._views[ k ];
					const id = view.model?.get?.( 'id' );
					if ( id ) {
						index.set( id, view );
					}
					if ( view.children ) {
						walk( view.children );
					}
				}
			};
			const root = elementor.getPreviewView?.()?.children;
			if ( root ) {
				walk( root );
			}
			return index;
		};

		const scheduleIndexClear = () => {
			if ( viewIndexScheduled ) {
				return;
			}
			viewIndexScheduled = true;
			const clear = () => {
				viewIndex = null;
				viewIndexScheduled = false;
			};
			if ( 'function' === typeof window.requestAnimationFrame ) {
				window.requestAnimationFrame( clear );
			} else {
				setTimeout( clear, 16 );
			}
		};

		const findViewByIdIndexed = ( id ) => {
			if ( ! viewIndex ) {
				viewIndex = buildViewIndex();
				scheduleIndexClear();
			}
			let view = viewIndex.get( id );
			if ( view && ! view._isDestroyed ) {
				return view;
			}
			// Cache miss or stale: rebuild once and retry. Cheap when tree is unchanged,
			// safe when it has churned. Falls back to false on genuine miss.
			viewIndex = buildViewIndex();
			view = viewIndex.get( id );
			return ( view && ! view._isDestroyed ) ? view : false;
		};

		return {
			findViewRecursive,
			findViewById: ( id ) => {
				if ( elementorCommon?.config?.experimentalFeatures?.e_memoize_active_controls ) {
					return findViewByIdIndexed( id ) || false;
				}
				const elements = findViewRecursive(
					elementor.getPreviewView().children,
					'id',
					id,
					false,
				);
				return elements ? elements[ 0 ] : false;
			},
			findContainerById: ( id ) => {
				let result = this.utils.findViewById( id );

				if ( result ) {
					result = result.getContainer();
				}

				return result;
			},
			findModelById: ( id, collection = elementor.elementsModel.get( 'elements' ) ) => {
				for ( const model of collection?.models ?? [] ) {
					const found = model.get( 'id' ) === id
						? model
						: this.utils.findModelById( id, model.get( 'elements' ) );

					if ( found ) {
						return found;
					}
				}

				return null;
			},
			addModelToParent: ( parentId, childData, options ) => {
				const parentModel = this.utils.findModelById( parentId );

				if ( ! parentModel ) {
					return false;
				}

				const elements = parentModel.get( 'elements' );

				if ( ! elements ) {
					return false;
				}

				elements.add( childData, { at: options?.at, silent: true } );

				return true;
			},
			removeModelFromParent: ( parentId, childId ) => {
				const parentModel = this.utils.findModelById( parentId );

				if ( ! parentModel ) {
					return false;
				}

				const elements = parentModel.get( 'elements' );

				if ( ! elements ) {
					return false;
				}

				const child = elements.findWhere( { id: childId } );

				if ( ! child ) {
					return false;
				}

				elements.remove( child, { silent: true } );

				return true;
			},
		};
	}
}

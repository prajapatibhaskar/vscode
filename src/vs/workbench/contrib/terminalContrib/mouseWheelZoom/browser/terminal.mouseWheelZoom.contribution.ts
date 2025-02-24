/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Terminal as RawXtermTerminal } from '@xterm/xterm';
import { Event } from 'vs/base/common/event';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { MouseWheelClassifier } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { Disposable, MutableDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { isMacintosh } from 'vs/base/common/platform';
import { TerminalSettingId } from 'vs/platform/terminal/common/terminal';
import { IDetachedTerminalInstance, ITerminalContribution, ITerminalInstance, IXtermTerminal } from 'vs/workbench/contrib/terminal/browser/terminal';
import { registerTerminalContribution } from 'vs/workbench/contrib/terminal/browser/terminalExtensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITerminalProcessInfo, ITerminalProcessManager } from 'vs/workbench/contrib/terminal/common/terminal';
import { TerminalWidgetManager } from 'vs/workbench/contrib/terminal/browser/widgets/widgetManager';

class TerminalMouseWheelZoomContribution extends Disposable implements ITerminalContribution {
	static readonly ID = 'terminal.mouseWheelZoom';

	/**
	 * Currently focused find widget. This is used to track action context since
	 * 'active terminals' are only tracked for non-detached terminal instanecs.
	 */
	static activeFindWidget?: TerminalMouseWheelZoomContribution;

	static get(instance: ITerminalInstance | IDetachedTerminalInstance): TerminalMouseWheelZoomContribution | null {
		return instance.getContribution<TerminalMouseWheelZoomContribution>(TerminalMouseWheelZoomContribution.ID);
	}

	private _listener = this._register(new MutableDisposable());

	constructor(
		instance: ITerminalInstance | IDetachedTerminalInstance,
		processManager: ITerminalProcessManager | ITerminalProcessInfo,
		widgetManager: TerminalWidgetManager,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	xtermReady(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void {
		this._register(Event.runAndSubscribe(this._configurationService.onDidChangeConfiguration, e => {
			if (!e || e.affectsConfiguration(TerminalSettingId.MouseWheelZoom)) {
				if (!!this._configurationService.getValue(TerminalSettingId.MouseWheelZoom)) {
					this._setupMouseWheelZoomListener(xterm.raw);
				} else {
					this._listener.clear();
				}
			}
		}));
	}

	private _getConfigFontSize(): number {
		return this._configurationService.getValue(TerminalSettingId.FontSize);
	}

	private _setupMouseWheelZoomListener(raw: RawXtermTerminal) {
		// This is essentially a copy of what we do in the editor, just we modify font size directly
		// as there is no separate zoom level concept in the terminal
		const classifier = MouseWheelClassifier.INSTANCE;

		let prevMouseWheelTime = 0;
		let gestureStartFontSize = this._getConfigFontSize();
		let gestureHasZoomModifiers = false;
		let gestureAccumulatedDelta = 0;

		raw.attachCustomWheelEventHandler((e: WheelEvent) => {
			const browserEvent = e as any as IMouseWheelEvent;
			if (classifier.isPhysicalMouseWheel()) {
				if (hasMouseWheelZoomModifiers(browserEvent)) {
					const delta = browserEvent.deltaY > 0 ? -1 : 1;
					this._configurationService.updateValue(TerminalSettingId.FontSize, this._getConfigFontSize() + delta);
					// EditorZoom.setZoomLevel(zoomLevel + delta);
					browserEvent.preventDefault();
					browserEvent.stopPropagation();
					return false;
				}
			} else {
				// we consider mousewheel events that occur within 50ms of each other to be part of the same gesture
				// we don't want to consider mouse wheel events where ctrl/cmd is pressed during the inertia phase
				// we also want to accumulate deltaY values from the same gesture and use that to set the zoom level
				if (Date.now() - prevMouseWheelTime > 50) {
					// reset if more than 50ms have passed
					gestureStartFontSize = this._getConfigFontSize();
					gestureHasZoomModifiers = hasMouseWheelZoomModifiers(browserEvent);
					gestureAccumulatedDelta = 0;
				}

				prevMouseWheelTime = Date.now();
				gestureAccumulatedDelta += browserEvent.deltaY;

				if (gestureHasZoomModifiers) {
					const deltaAbs = Math.ceil(Math.abs(gestureAccumulatedDelta / 5));
					const deltaDirection = gestureAccumulatedDelta > 0 ? -1 : 1;
					const delta = deltaAbs * deltaDirection;
					this._configurationService.updateValue(TerminalSettingId.FontSize, gestureStartFontSize + delta);
					gestureAccumulatedDelta += browserEvent.deltaY;
					browserEvent.preventDefault();
					browserEvent.stopPropagation();
					return false;
				}
			}
			return true;
		});
		this._listener.value = toDisposable(() => raw.attachCustomWheelEventHandler(() => true));
	}
}

registerTerminalContribution(TerminalMouseWheelZoomContribution.ID, TerminalMouseWheelZoomContribution, true);

function hasMouseWheelZoomModifiers(browserEvent: IMouseWheelEvent): boolean {
	return (
		isMacintosh
			// on macOS we support cmd + two fingers scroll (`metaKey` set)
			// and also the two fingers pinch gesture (`ctrKey` set)
			? ((browserEvent.metaKey || browserEvent.ctrlKey) && !browserEvent.shiftKey && !browserEvent.altKey)
			: (browserEvent.ctrlKey && !browserEvent.metaKey && !browserEvent.shiftKey && !browserEvent.altKey)
	);
}

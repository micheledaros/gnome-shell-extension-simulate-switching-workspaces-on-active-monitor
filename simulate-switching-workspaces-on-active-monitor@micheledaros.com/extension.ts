import Clutter from "gi://Clutter";
import Shell from "gi://Shell";
import St from "gi://St";
import Meta from "gi://Meta";
import Gio from "gi://Gio";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import {Extension} from "resource:///org/gnome/shell/extensions/extension.js";
import {gettext as _} from "gettext";

const HOTKEY_NEXT = "switch-to-next-workspace-on-active-monitor";
const HOTKEY_PREVIOUS = "switch-to-previous-workspace-on-active-monitor";

enum Direction {
    UP = -1, DOWN = 1,
}

const DEBUG_ACTIVE = false;

class WindowWrapper {
    private windowActor: Meta.WindowActor;
    private metaWindow: Meta.Window;
    private readonly windowType: Meta.WindowType;
    private readonly initialMonitorIndex: number;
    private readonly title: string;

    constructor(windowActor: Meta.WindowActor) {
        this.windowActor = windowActor;
        this.metaWindow = this.windowActor.get_meta_window()!;
        this.windowType = this.metaWindow.get_window_type();
        this.initialMonitorIndex = this.getMonitorIndex();
        this.title = this.metaWindow.get_title();
    }

    getTitle(): string {
        return this.title;
    }

    getWorkspaceIndex(): number {
        return this.metaWindow.get_workspace().index();
    }

    getMonitorIndex(): number {
        return this.metaWindow.get_monitor();
    }

    getInitialMonitorIndex(): number {
        return this.initialMonitorIndex;
    }

    isNormal(): boolean {
        return this.windowType === Meta.WindowType.NORMAL;
    }

    moveToWorkSpace(nextIndex: number): void {
        this.metaWindow.change_workspace_by_index(nextIndex, false);
    }

    toString(): string {
        return `
            title: ${this.getTitle()}
            windowType: ${this.windowType}
            monitorIndex: ${this.getMonitorIndex()}
            workspaceIndex: ${this.getWorkspaceIndex()}
            isNormal: ${this.isNormal()}
            `;
    }
}

class WorkSpacesService {
    private _configurationService: ConfigurationService;
    private _activeWorkspaceIndex: number;
    private _nWorkspaces!: number;

    constructor(_configurationService: ConfigurationService) {
        this._configurationService = _configurationService;
        this._initNWorkspaces();
        this._activeWorkspaceIndex = this._getActiveWorkspaceIndex();
    }

    switchToPreviouslyActiveWorkspaceOnInactiveMonitors(): void {
        if (!this._configurationService.automaticSwitchingIsEnabled()) {
            maybeLog(`not switching to previously active workspace because automaticSwitching is disabled`);
            return;
        }

        this._initNWorkspaces();

        const nextWorkspace = this._getActiveWorkspaceIndex();

        const direction = nextWorkspace > this._activeWorkspaceIndex ? Direction.DOWN : Direction.UP;

        const diff = nextWorkspace > this._activeWorkspaceIndex ? nextWorkspace - this._activeWorkspaceIndex : this._activeWorkspaceIndex - nextWorkspace;
        const shift = direction * diff;

        const focusedMonitorIndex = this._getFocusedMonitor();

        this._activeWorkspaceIndex = nextWorkspace;

        maybeLog(` workspaceChanged
            direction: ${direction}
            diff: ${diff}
            activeMonitor: ${focusedMonitorIndex}
        `);

        this._getWindowWrappers()
            .filter((it) => it.isNormal())
            .filter((it) => it.getInitialMonitorIndex() != focusedMonitorIndex)
            .forEach((it) => {
                this._moveToDirection(it, shift);
            });

        maybeLog("switched to previously active workspace on inactive monitors");
    }

    switchWorkspaceOnActiveMonitor(direction: Direction): void {
        maybeLog("begin  switchActiveWorkspace");

        this._initNWorkspaces();

        let wrappers = this._getWindowWrappers();

        maybeLog(`  got ${wrappers.length} windows`);
        wrappers.forEach((it) => {
            maybeLog(it.toString());
        });

        let focusedMonitorIndex = this._getFocusedMonitor();

        let windowsToMove = wrappers
            .filter((it) => it.isNormal())
            .filter((it) => it.getInitialMonitorIndex() === focusedMonitorIndex);

        maybeLog(" those windows will be moved: ");
        windowsToMove.forEach((it) => {
            maybeLog(it.toString());
        });

        windowsToMove.forEach((it) => this._moveToDirection(it, direction));
    }

    _getWindowWrappers(): WindowWrapper[] {
        return global.get_window_actors().map((x) => new WindowWrapper(x));
    }

    _getFocusedMonitor(): number {
        // TODO: fix compatibility with Gnome 45 (see README.md)
        // The missing API is being unable to override Main.activateWindow. 
        // As far as I understand it was used as follows:
        // - Have a window 1 on monitor 1 and a window 2 on monitor 2
        // - Focus window 1, mouse pointer within it
        // - Alt tab into window 2, mouse pointer remaining within windows 1
        // - Now get_current_monitor returns monitor 1, despite the focus being within monitor 2. Before the update, activateWindow would override it.
        let currentMonitor = global.display.get_current_monitor();
        maybeLog(` focus is currently on monitor ${currentMonitor} `);
        return currentMonitor;
    }

    _initNWorkspaces(): void {
        this._nWorkspaces = global.workspace_manager.get_n_workspaces();
        maybeLog(`  workspacesService.nWorkspaces: ${this._nWorkspaces} `);
    }

    _moveToDirection(windowWrapper: WindowWrapper, direction: Direction): void {
        let nextWorkspace = (this._nWorkspaces + windowWrapper.getWorkspaceIndex() + direction) % this._nWorkspaces;
        maybeLog(`window: ${windowWrapper.getTitle()} will be moved to  workspace will be ${nextWorkspace}`);
        windowWrapper.moveToWorkSpace(nextWorkspace);
    }

    _getActiveWorkspaceIndex(): number {
        return global.workspace_manager.get_active_workspace_index();
    }
}

class Controller {
    private _workspaceService: WorkSpacesService;
    private readonly _gsettings: Gio.Settings;

    constructor(workspaceService: WorkSpacesService, settings: Gio.Settings) {
        this._workspaceService = workspaceService;
        this._gsettings = settings;
    }

    up(): void {
        this._workspaceService.switchWorkspaceOnActiveMonitor(Direction.UP);
    }

    down(): void {
        this._workspaceService.switchWorkspaceOnActiveMonitor(Direction.DOWN);
    }

    getGSettings(): Gio.Settings {
        return this._gsettings;
    }
}

class ConfigurationService {
    private readonly _appActivateHasRightImplementation: boolean;
    private readonly _activateWindowHasRightImplementation: boolean;
    private _staticWorkspaces: boolean;
    private _spanDisplays: boolean;
    private _warningMenu: PanelMenu.Button | null;
    private _warningItem: PopupMenu.PopupMenuItem | null;
    private _warningMenuText: string | null;
    private readonly _PROBLEM_APPACTIVATE: string;
    private readonly _PROBLEM_STATIC_WORKSPACES: string;
    private readonly _PROBLEM_SPAN_DISPLAYS: string;

    constructor() {
        this._appActivateHasRightImplementation = false;
        this._activateWindowHasRightImplementation = false;
        this._staticWorkspaces = false;
        this._spanDisplays = false;
        this._warningMenu = null;
        this._warningItem = null;
        this._warningMenuText = null;

        this._PROBLEM_APPACTIVATE = "- Another incompatible extension is active. Please disable the other extensions and restart gnome-shell";
        this._PROBLEM_STATIC_WORKSPACES = `- The option "Static Workspaces" is not active`;
        this._PROBLEM_SPAN_DISPLAYS = `- The option "Workspaces span displays" is not active`;
    }

    conditionallyEnableAutomaticSwitching(): void {
        this._staticWorkspaces = !Meta.prefs_get_dynamic_workspaces();
        this._spanDisplays = !Meta.prefs_get_workspaces_only_on_primary();
        maybeLog(this.toString());
    }

    automaticSwitchingIsEnabled(): boolean {
        return this._staticWorkspaces && this._spanDisplays;
    }

    eventuallyShowWarningMenu(): void {
        if (!this.automaticSwitchingIsEnabled()) {
            this._showWarningMenu();
        } else {
            this.eventuallyDestroyWarningMenu();
        }
    }

    eventuallyDestroyWarningMenu(): void {
        maybeLog("warningMenu should be removed");
        if (this._warningMenu) {
            maybeLog("destroying warningMenu");
            this._warningMenu.destroy();
            this._warningMenu = null;
            this._warningItem = null;
            this._warningMenuText = null;
        }
    }

    _showWarningMenu(): void {
        maybeLog("warningMenu should be shown");
        if (this._warningMenu == null) {
            maybeLog("building warning menu");
            this._warningMenu = new PanelMenu.Button(0.0, _("simulate-switching-workspaces-on-active-monitor"));
            let warningSymbol = new St.Label({
                text: "\u26a0",  // ⚠, warning
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._warningMenu.add_child(warningSymbol);
            if (!(this._warningMenu.menu instanceof PopupMenu.PopupDummyMenu)) {
                this._warningMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                this._warningItem = new PopupMenu.PopupMenuItem("just a placeholder text");
                this._warningMenu.menu.addMenuItem(this._warningItem);
            }
            maybeLog("adding the warning menu to the status area");
            Main.panel.addToStatusArea("drive-menu", this._warningMenu);
        }
        let text = this.getProblems();
        if (text !== this._warningMenuText) {
            this._warningItem!.label.set_text(text);
            this._warningMenuText = text;
        }
    }

    getProblems(): string {
        let list: string[] = [];
        if (!(this._appActivateHasRightImplementation && this._activateWindowHasRightImplementation)) {
            list.push(this._PROBLEM_APPACTIVATE);
        }
        if (!this._staticWorkspaces) {
            list.push(this._PROBLEM_STATIC_WORKSPACES);
        }
        if (!this._spanDisplays) {
            list.push(this._PROBLEM_SPAN_DISPLAYS);
        }
        return `Switch workspaces on active monitor can't work properly, because of the following issues:\n\n${list.join("\n")}`;
    }

    toString(): string {
        return `
                automaticSwitchingIsEnabled: ${this.automaticSwitchingIsEnabled()} 
                appActivateHasRightImplementation: ${this._appActivateHasRightImplementation} 
                activateWindowHasRightImplementation: ${this._activateWindowHasRightImplementation} 
                staticWorkspaces: ${this._staticWorkspaces}
                spanDisplays: ${this._spanDisplays}
                `;
    }
}

function onWorkspaceChanged(): void {
    configurationService!.conditionallyEnableAutomaticSwitching();
    configurationService!.eventuallyShowWarningMenu();
    workspaceService!.switchToPreviouslyActiveWorkspaceOnInactiveMonitors();
}

let controller: Controller | null = null;
let workspaceService: WorkSpacesService | null = null;
let configurationService: ConfigurationService | null = null;
let workSpaceChangedListener: number | null = null;

// let extensionStateChangedListener;

function enable(settings: Gio.Settings): void {
    configurationService = new ConfigurationService();
    configurationService.conditionallyEnableAutomaticSwitching();
    configurationService.eventuallyShowWarningMenu();

    workspaceService = new WorkSpacesService(configurationService);
    controller = new Controller(workspaceService, settings);

    workSpaceChangedListener = global.workspace_manager.connect("active-workspace-changed", onWorkspaceChanged);

    addKeybinding();
    configurationService.conditionallyEnableAutomaticSwitching();
    maybeLog("enabled");
}

function disable(): void {
    removeKeybinding();

    if (workSpaceChangedListener) {
        global.workspace_manager.disconnect(workSpaceChangedListener);
    }

    configurationService!.eventuallyDestroyWarningMenu();

    controller = null;
    workspaceService = null;
    configurationService = null;
    workSpaceChangedListener = null;
    maybeLog("disabled");
}

function addKeybinding(): void {
    let modeType = Shell.ActionMode.ALL;

    Main.wm.addKeybinding(HOTKEY_NEXT, controller!.getGSettings(), Meta.KeyBindingFlags.NONE, modeType, controller!.up.bind(controller));

    Main.wm.addKeybinding(HOTKEY_PREVIOUS, controller!.getGSettings(), Meta.KeyBindingFlags.NONE, modeType, controller!.down.bind(controller));
}

function removeKeybinding(): void {
    Main.wm.removeKeybinding(HOTKEY_NEXT);
    Main.wm.removeKeybinding(HOTKEY_PREVIOUS);
}

function maybeLog(value: string): void {
    if (DEBUG_ACTIVE) {
        console.log(value);
    }
}

export default class SwitchWorkspacesExtension extends Extension {
    enable(): void {
        enable(this.getSettings());
    }

    disable(): void {
        disable();
    }
}
import Clutter from "gi://Clutter";
import Shell from "gi://Shell";
import St from "gi://St";
import Meta from "gi://Meta";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import {Extension} from "resource:///org/gnome/shell/extensions/extension.js";

const SCHEMA = "org.gnome.shell.extensions.simulate-switching-workspaces-on-active-monitor";
const HOTKEY_NEXT = "switch-to-next-workspace-on-active-monitor";
const HOTKEY_PREVIOUS = "switch-to-previous-workspace-on-active-monitor";

const UP = -1;
const DOWN = 1;
const DEBUG_ACTIVE = false;

class WindowWrapper {
    constructor(windowActor) {
        this.windowActor = windowActor;
        this.metaWindow = this.windowActor.get_meta_window();
        this.windowType = this.metaWindow.get_window_type();
        this.initialMonitorIndex = this.getMonitorIndex();
        this.title = this.getTitle();
    }

    getTitle() {
        return this.metaWindow.get_title();
    }

    getWorkspaceIndex() {
        return this.metaWindow.get_workspace().index();
    }

    getMonitorIndex() {
        return this.metaWindow.get_monitor();
    }

    isNormal() {
        return this.windowType === Meta.WindowType.NORMAL;
    }

    moveToWorkSpace(nextIndex) {
        this.metaWindow.change_workspace_by_index(nextIndex, false);
    }

    toString() {
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
    constructor(_configurationService) {
        this._configurationService = _configurationService;
        this._initNWorskpaces();
        this._activeWorkspaceIndex =
            this._getActiveWorkspaceIndex();
    }

    switchToPreviouslyActiveWorkspaceOnInactiveMonitors() {
        if (!this._configurationService.automaticSwitchingIsEnabled()) {
            maybeLog(`not switching to previously active workspace because automaticSwitching is disabled`);
            return
        }

        this._initNWorskpaces();

        const nextWorkspace = this._getActiveWorkspaceIndex();

        const direction = nextWorkspace > this._activeWorkspaceIndex ? DOWN : UP;

        const diff =
            nextWorkspace > this._activeWorkspaceIndex
                ? nextWorkspace - this._activeWorkspaceIndex
                : this._activeWorkspaceIndex - nextWorkspace;
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
            .filter((it) => it.initialMonitorIndex != focusedMonitorIndex)
            .forEach((it) => {
                this._moveToDirection(it, shift);
            });

        maybeLog("switched to previously active workspace on inactive monitors");
    }

    switchWorkspaceOnActiveMonitor(direction) {
        maybeLog("begin  switchActiveWorkspace");

        this._initNWorskpaces();

        let wrappers = this._getWindowWrappers();

        maybeLog(`  got ${wrappers.length} windows`);
        wrappers.forEach((it) => {
            maybeLog(it.toString());
        });

        let focusedMonitorIndex = this._getFocusedMonitor();

        let windowsToMove = wrappers
            .filter((it) => it.isNormal())
            .filter((it) => it.initialMonitorIndex === focusedMonitorIndex);

        maybeLog(" those windows will be moved: ");
        windowsToMove.forEach((it) => {
            maybeLog(it.toString());
        });

        windowsToMove.forEach((it) => this._moveToDirection(it, direction));
    }

    _getWindowWrappers() {
        return global.get_window_actors().map((x) => new WindowWrapper(x));
    }

    _getFocusedMonitor() {
        // Note: should incorporate this somehow
        // The problem is when you change the workspace once,
        // the focus window is now gone, and it may then find a focus window on the other workspace
        // and start changing that. not sure how to work around this.
        // global.display.focus_window.get_monitor()
        return global.display.get_current_monitor();
    }

    _initNWorskpaces() {
        this._nWorkspaces = global.workspace_manager.get_n_workspaces();
        maybeLog(`  workspacesService.nWorkspaces: ${this._nWorkspaces} `);
    }

    _moveToDirection(windowWrapper, direction) {
        let nextWorkspace = (this._nWorkspaces + windowWrapper.getWorkspaceIndex() + direction) % this._nWorkspaces;
        maybeLog(`window: ${windowWrapper.title} will be moved to  workspace will be ${nextWorkspace}`);
        windowWrapper.moveToWorkSpace(nextWorkspace);
    }

    _getActiveWorkspaceIndex() {
        return global.workspace_manager.get_active_workspace_index();
    }
}

class Controller {
    constructor(workspaceService, settings) {
        this._workspaceService = workspaceService;
        this._gsettings = settings;
    }

    up() {
        this._workspaceService.switchWorkspaceOnActiveMonitor(UP);
    }

    down() {
        this._workspaceService.switchWorkspaceOnActiveMonitor(DOWN);
    }
}

class ConfigurationService {

    constructor() {
        this._appActivateHasRightImplementation = false;
        this._activateWindowHasRightImplementation = false;
        this._staticWorkspaces = false
        this._spanDisplays = false
        this._warningMenu = null
        this.warningItem = null
        this._warningMenuText = null

        this._PROBLEM_APPACTIVATE = "- Another incompatible extension is active. Please disable the other extensions and restart gnome-shell"
        this._PROBLEM_STATIC_WORKSPACES = `- The option "Static Workspaces" is not active`
        this._PROBLEM_SPAN_DISPLAYS = `- The option "Workspaces span displays" is not active`

    }

    conditionallyEnableAutomaticSwitching() {
        this._staticWorkspaces = !Meta.prefs_get_dynamic_workspaces()
        this._spanDisplays = !Meta.prefs_get_workspaces_only_on_primary()
        maybeLog(this.toString())
    }


    automaticSwitchingIsEnabled() {
        return this._staticWorkspaces && this._spanDisplays
    }

    eventuallyShowWarningMenu() {
        if (!this.automaticSwitchingIsEnabled()) {
            this._showWarningMenu()
        } else {
            this.eventuallyDestroyWarningMenu()
        }
    }

    eventuallyDestroyWarningMenu() {
        maybeLog("warningMenu should be removed")
        if (this._warningMenu){
            maybeLog("destroying warningMenu")
            this._warningMenu.destroy()
            this._warningMenu = null;
            this.warningItem = null
            this._warningMenuText = null
        }
    }

    _showWarningMenu() {
        maybeLog("warningMenu should be shown")
        if (this._warningMenu == null) {
            maybeLog("building warning menu")
            this._warningMenu = new PanelMenu.Button(0.0, _('simulate-switching-workspaces-on-active-monitor'));
            let warningSymbol = new St.Label({
                text: '\u26a0',  // ⚠, warning
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER});
            this._warningMenu.add_child(warningSymbol);
            this._warningMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._warningItem = new PopupMenu.PopupMenuItem(
                "just a placehoder text"
            );
            this._warningMenu.menu.addMenuItem(this._warningItem)
            maybeLog("adding the warning menu to the status area")
            Main.panel.addToStatusArea('drive-menu', this._warningMenu);
        }
        let text = this.getProblems()
        if (text !== this._warningMenuText) {
            this._warningItem.label.set_text(text);
            this._warningMenuText=text;
        }
    }



    getProblems() {
        let list = []
        if (! (this._appActivateHasRightImplementation && this._activateWindowHasRightImplementation)) {
            list.push(this._PROBLEM_APPACTIVATE);
        }
        if (!this._staticWorkspaces) {
            list.push(this._PROBLEM_STATIC_WORKSPACES);
        }
        if (!this._spanDisplays) {
            list.push(this._PROBLEM_SPAN_DISPLAYS)
        }
        return `Switch workspaces on active monitor can't work properly, because of the following issues:\n\n${list.join("\n")}`
    }

    toString() {
        return `
                automaticSwitchingIsEnabled: ${this.automaticSwitchingIsEnabled()} 
                appActivateHasRightImplementation: ${this._appActivateHasRightImplementation} 
                activateWindowHasRightImplementation: ${this._activateWindowHasRightImplementation} 
                staticWorkspaces: ${this._staticWorkspaces}
                spanDisplays: ${this._spanDisplays}
                `
    }
}

function onWorkspaceChanged() {
    configurationService.conditionallyEnableAutomaticSwitching()
    configurationService.eventuallyShowWarningMenu()
    workspaceService.switchToPreviouslyActiveWorkspaceOnInactiveMonitors();
}

let controller;
let workspaceService;
let configurationService;
let originalAppActivate
let workSpaceChangedListener;
// let extensionStateChangedListener;

function enable(settings) {
    configurationService = new ConfigurationService();
    configurationService.conditionallyEnableAutomaticSwitching()
    configurationService.eventuallyShowWarningMenu()

    workspaceService = new WorkSpacesService(configurationService);
    controller = new Controller(workspaceService, settings);



    workSpaceChangedListener = global.workspace_manager.connect(
        "active-workspace-changed",
        onWorkspaceChanged
    );

    addKeybinding();
    configurationService.conditionallyEnableAutomaticSwitching();
    maybeLog("enabled")
}

function disable() {
    removeKeybinding();

    if (workSpaceChangedListener) {
        global.workspace_manager.disconnect(workSpaceChangedListener);
    }

    configurationService.eventuallyDestroyWarningMenu();

    controller = null;
    workspaceService = null;
    configurationService = null;
    originalAppActivate = null
    workSpaceChangedListener = null;
    //extensionStateChangedListener = null;
    maybeLog("disabled")
}

function addKeybinding() {
    let modeType = Shell.ActionMode.ALL;

    Main.wm.addKeybinding(
        HOTKEY_NEXT,
        controller._gsettings,
        Meta.KeyBindingFlags.NONE,
        modeType,
        controller.up.bind(controller)
    );

    Main.wm.addKeybinding(
        HOTKEY_PREVIOUS,
        controller._gsettings,
        Meta.KeyBindingFlags.NONE,
        modeType,
        controller.down.bind(controller)
    );
}

function removeKeybinding() {
    Main.wm.removeKeybinding(HOTKEY_NEXT);
    Main.wm.removeKeybinding(HOTKEY_PREVIOUS);
}

function maybeLog(value) {
    if (DEBUG_ACTIVE) {
        log(value);
    }
}

export default class SwitchWorkspacesExtension extends Extension {
    enable() {
        enable(this.getSettings());
    }

    disable() {
        disable();
    }
}


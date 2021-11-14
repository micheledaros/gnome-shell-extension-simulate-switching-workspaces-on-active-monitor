const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;

const SCHEMA = "org.gnome.shell.extensions.simulate-switching-workspaces-on-active-monitor";
const HOTKEY_NEXT = "switch-to-next-workspace-on-active-monitor";
const HOTKEY_PREVIOUS = "switch-to-previous-workspace-on-active-monitor";

const UP = -1;
const DOWN = 1;
const DEBUG_ACTIVE = true;

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
        this._monitorActivatedWithFocus = null;
    }

    windowActivatedWithFocus(window) {
        if (window.get_workspace().index() != this._getActiveWorkspaceIndex()) {
            let monitor = window.get_monitor();
            maybeLog(`next active monitor will be ${monitor}`)
            this._monitorActivatedWithFocus = monitor;
        }
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

        const focusedMonitorIndex = this._monitorActivatedWithFocus != null
            ? this._monitorActivatedWithFocus
            : this._getFocusedMonitor();

        this._monitorActivatedWithFocus = null

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
    constructor(workspaceService) {
        this._workspaceService = workspaceService;
        this._gsettings = ExtensionUtils.getSettings();
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
        this._staticWorkspaces = false
        this._spanDisplays = false
    }

    conditionallyEnableAutomaticSwitching() {
        this._appActivateHasRightImplementation = Shell.App.prototype.activate == overridenAppActivate
        this._staticWorkspaces = !Meta.prefs_get_dynamic_workspaces()
        this._spanDisplays = !Meta.prefs_get_workspaces_only_on_primary()
        maybeLog(this.toString())
    }

    automaticSwitchingIsEnabled() {
        return this._appActivateHasRightImplementation && this._staticWorkspaces && this._spanDisplays
    }

    toString() {
        return `
                automaticSwitchingIsEnabled: ${this.automaticSwitchingIsEnabled()} 
                appActivateHasRightImplementation: ${this._appActivateHasRightImplementation} 
                staticWorkspaces: ${this._staticWorkspaces}
                spanDisplays: ${this._spanDisplays}
                `
    }
}

function onWorkspaceChanged() {
    configurationService.conditionallyEnableAutomaticSwitching()
    workspaceService.switchToPreviouslyActiveWorkspaceOnInactiveMonitors();
}

function onExtensionStateChanged(extension, state) {
    maybeLog(`an extension state changed ${extension.uid}, ${state.state}`)
    configurationService.conditionallyEnableAutomaticSwitching();
}

function overridenAppActivate() {
    maybeLog(`overridden App::activate`)
    let activeWindows = this.get_windows();
    if (workspaceService && activeWindows && activeWindows[0]) {
        workspaceService.windowActivatedWithFocus(activeWindows[0]);
    }
    return originalAppActivate.call(this);
}

let controller;
let workspaceService;
let configurationService;
let originalAppActivate
let workSpaceChangedListener;
// let extensionStateChangedListener;

function enable() {
    configurationService = new ConfigurationService();
    workspaceService = new WorkSpacesService(configurationService);
    controller = new Controller(workspaceService);

    originalAppActivate = Shell.App.prototype.activate;
    Shell.App.prototype.activate = overridenAppActivate

    workSpaceChangedListener = global.workspace_manager.connect(
        "active-workspace-changed",
        onWorkspaceChanged
    );

    // extensionStateChangedListener = Main.extensionManager.connect(
    //     "extension-state-changed",
    //     onExtensionStateChanged
    // );

    addKeybinding();
    configurationService.conditionallyEnableAutomaticSwitching();
    maybeLog("enabled")
}

function disable() {
    removeKeybinding();

    if (workSpaceChangedListener) {
        global.workspace_manager.disconnect(workSpaceChangedListener);
    }

    // if (extensionStateChangedListener) {
    //     global.workspace_manager.disconnect(extensionStateChangedListener);
    // }

    //don't restore the prototype, if it has been overridden in another extension
    if (Shell.App.prototype.activate === overridenAppActivate) {
        maybeLog("restoring the original implementation of Shell.App.activate")
        Shell.App.prototype.activate = originalAppActivate
    }

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

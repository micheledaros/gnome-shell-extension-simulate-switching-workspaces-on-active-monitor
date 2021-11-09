const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Mainloop = imports.mainloop;
const GObject = imports.gi.GObject;

const Gettext = imports.gettext.domain("gnome-shell-extensions");
const _ = Gettext.gettext;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const SCHEMA =
  "org.gnome.shell.extensions.simulate-switching-workspaces-on-active-monitor";
const HOTKEY_NEXT = "switch-to-next-workspace-on-active-monitor";
const HOTKEY_PREVIOUS = "switch-to-previous-workspace-on-active-monitor";

const UP = -1;
const DOWN = 1;

const DEBUG_ACTIVE = false;

class WindowWrapper {
  constructor(windowActor, monitorIndex, workspaceIndex) {
    this.windowActor = windowActor;
    this.metaWindow = this.windowActor.get_meta_window();
    this.windowType = this.metaWindow.get_window_type();
    this.initialMonitorIndex = this.getMonitorIndex();
    this.initialWorkspaceIndex = this.getWorkspaceIndex();
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

  toString() {
    return `
            title: ${this.getTitle()}
            windowType: ${this.windowType}
            monitorIndex: ${this.getMonitorIndex()}
            workspaceIndex: ${this.getWorkspaceIndex()}
            isNormal: ${this.isNormal()}
            `;
  }

  isNormal() {
    return this.windowType === Meta.WindowType.NORMAL;
  }

  moveToWorkSpace(nextIndex) {
    this.metaWindow.change_workspace_by_index(nextIndex, false);
  }
}

class WorkSpacesService {
  constructor() {
    this._initNWorskpaces();
    maybeLog(`  workspacesService.nWorkspaces: ${this._nWorkspaces} `);
  }

  _initNWorskpaces() {
    this._nWorkspaces = global.workspace_manager.get_n_workspaces();
  }

  _moveToWorkspace(windowWrapper, direction) {
    let nextWorkspace =
      (this._nWorkspaces + windowWrapper.getWorkspaceIndex() + direction) %
      this._nWorkspaces;
    maybeLog(`next workspace will be ${nextWorkspace}`);
    windowWrapper.moveToWorkSpace(nextWorkspace);
  }

  switchWorkspaceOnActiveMonitor(direction) {
    maybeLog("begin  switchActiveWorkspace");

    this._initNWorskpaces();

    let wrappers = this.getWindowWrappers();

    maybeLog(`  got ${wrappers.length} windows`);
    wrappers.forEach((it) => {
      maybeLog(it.toString());
    });

    let focusedMonitorIndex = this.getFocusedMonitor();

    let windowsToMove = wrappers
      .filter((it) => it.isNormal())
      .filter((it) => it.initialMonitorIndex === focusedMonitorIndex);

    maybeLog(" those windows will be moved: ");
    windowsToMove.forEach((it) => {
      maybeLog(it.toString());
    });

    windowsToMove.forEach((it) => this._moveToWorkspace(it, direction));
  }

  getWindowWrappers() {
    return global.get_window_actors().map((x) => new WindowWrapper(x, x, x));
  }

  getFocusedMonitor() {
    return global.display.get_current_monitor();
  }
}

class Controller {
  constructor(workspaceService) {
    this._workspaceService = workspaceService;
    this._gsettings = ExtensionUtils.getSettings(SCHEMA);
  }

  up() {
    this._workspaceService.switchWorkspaceOnActiveMonitor(UP);
  }

  down() {
    this._workspaceService.switchWorkspaceOnActiveMonitor(DOWN);
  }
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

let controller;
let workspaceService;

function init(metadata) {}

function enable() {
  log("enabling...");

  global.workspace_manager.connect("active-workspace-changed", function () {
    log("caught event");
  });

  workspaceService = new WorkSpacesService();
  controller = new Controller(workspaceService);
  addKeybinding();
  log("enabled");
}

function disable() {
  removeKeybinding();
  controller = null;
}

function maybeLog(value) {
  if (DEBUG_ACTIVE) {
    log(value);
  }
}

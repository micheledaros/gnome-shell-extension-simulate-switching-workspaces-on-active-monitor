const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Mainloop = imports.mainloop;
const GObject = imports.gi.GObject;

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const SCHEMA = 'org.gnome.shell.extensions.simulate-switching-workspaces-on-active-monitor';
const HOTKEY_NEXT = 'switch-to-next-workspace-on-active-monitor';
const HOTKEY_PREVIOUS = 'switch-to-previous-workspace-on-active-monitor';


const UP = -1
const DOWN = 1

const DEBUG_ACTIVE  = false

class WindowWrapper {
    constructor(windowActor, monitorIndex, workspaceIndex) {
      this.windowActor = windowActor;
      this.metaWindow = this.windowActor.get_meta_window()
      this.windowType = this.metaWindow.get_window_type()
      this.initialMonitorIndex = this.getMonitorIndex();
      this.initialWorkspaceIndex = this.getWorkspaceIndex();
    }

    getTitle() {
        return this.metaWindow.get_title()
    }

    getWorkspaceIndex() {
        return this.metaWindow.get_workspace().index()
    }

    getMonitorIndex() {
        return this.metaWindow.get_monitor()
    }

    toString() {
        return `
            title: ${this.getTitle()}
            windowType: ${this.windowType}
            monitorIndex: ${this.getMonitorIndex()}
            workspaceIndex: ${this.getWorkspaceIndex()}
            isNormal: ${this.isNormal()}
            `
    }

    isNormal () {
        return this.windowType === Meta.WindowType.NORMAL
    }

    moveToWorkSpace(nextIndex) {
        this.metaWindow.change_workspace_by_index(nextIndex, false)
    }

  }

  class WorkSpacesService {

    constructor() {
        this.nWorkspaces =  this.getNWorkspaces()
        maybeLog (`  workspacesService.nWorkspaces: ${this.nWorkspaces} `)
    }

    getNWorkspaces () {
        return global.workspace_manager.get_n_workspaces()
    }

    moveToWorkspace (windowWrapper, direction) {
        let nextWorkspace = (this.nWorkspaces + windowWrapper.getWorkspaceIndex() + direction) % this.nWorkspaces
        maybeLog (`next workspace will be ${nextWorkspace}`)
        windowWrapper.moveToWorkSpace(nextWorkspace)
    }

    switchWorkspaceOnActiveMonitor(direction) {
        maybeLog ('begin  switchActiveWorkspace')

        let workSpacesService = new WorkSpacesService()

        let wrappers = this.getWindowWrappers()

        maybeLog (`  got ${wrappers.length} windows`)
        wrappers
            .forEach (it => {maybeLog(it.toString())})


        let focusedMonitorIndex = this.getFocusedMonitor()

        let windowsToMove = wrappers
            .filter(it => it.isNormal())
            .filter(it => it.initialMonitorIndex === focusedMonitorIndex)

        maybeLog (' those windows will be moved: ')
            windowsToMove
            .forEach (it => {maybeLog(it.toString())})


        windowsToMove.forEach(it => workSpacesService.moveToWorkspace(it, direction))
    }

    getWindowWrappers() {

        return global.get_window_actors()
            .map (x => new WindowWrapper(x,x,x))

    }

    getFocusedMonitor() {
        return global.display.get_current_monitor();
    }

  }


class Controller  {
    constructor() {
        this._gsettings = ExtensionUtils.getSettings(SCHEMA);
    }

    up() {
        new WorkSpacesService().switchWorkspaceOnActiveMonitor(UP)
    }


    down() {
        new WorkSpacesService().switchWorkspaceOnActiveMonitor(DOWN)
    }
}


function addKeybinding() {
    let modeType = Shell.ActionMode.ALL;


    Main.wm.addKeybinding(HOTKEY_NEXT,
        controller._gsettings,
                          Meta.KeyBindingFlags.NONE,
                          modeType,
                          controller.up.bind(controller));

    Main.wm.addKeybinding(HOTKEY_PREVIOUS,
    controller._gsettings,
                        Meta.KeyBindingFlags.NONE,
                        modeType,
                        controller.down.bind(controller));

}

function removeKeybinding(){
    Main.wm.removeKeybinding(HOTKEY_NEXT);
    Main.wm.removeKeybinding(HOTKEY_PREVIOUS);
}

let controller;

function init(metadata) {
}

function enable() {
    controller = new Controller();
    addKeybinding();
}

function disable() {
    removeKeybinding();
    controller.destroy();
    controller=null
}

function maybeLog( value) {
    if (DEBUG_ACTIVE) {
        log(value)
    }
}
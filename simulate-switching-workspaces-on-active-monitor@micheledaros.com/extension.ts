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
    private configurationService: ConfigurationService;
    private activeWorkspaceIndex: number;
    private nWorkspaces!: number;

    constructor(_configurationService: ConfigurationService) {
        this.configurationService = _configurationService;
        this.initNWorkspaces();
        this.activeWorkspaceIndex = this.getActiveWorkspaceIndex();
    }

    switchToPreviouslyActiveWorkspaceOnInactiveMonitors(): void {
        if (!this.configurationService.automaticSwitchingIsEnabled()) {
            maybeLog(`not switching to previously active workspace because automaticSwitching is disabled`);
            return;
        }

        this.initNWorkspaces();

        const nextWorkspace = this.getActiveWorkspaceIndex();

        const direction = nextWorkspace > this.activeWorkspaceIndex ? Direction.DOWN : Direction.UP;

        const diff = nextWorkspace > this.activeWorkspaceIndex ? nextWorkspace - this.activeWorkspaceIndex : this.activeWorkspaceIndex - nextWorkspace;
        const shift = direction * diff;

        const focusedMonitorIndex = this.getFocusedMonitor();

        this.activeWorkspaceIndex = nextWorkspace;

        maybeLog(` workspaceChanged
            direction: ${direction}
            diff: ${diff}
            activeMonitor: ${focusedMonitorIndex}
        `);

        this.getWindowWrappers()
            .filter((it) => it.isNormal())
            .filter((it) => it.getInitialMonitorIndex() !== focusedMonitorIndex)
            .forEach((it) => {
                this.moveToDirection(it, shift);
            });

        maybeLog("switched to previously active workspace on inactive monitors");
    }

    switchWorkspaceOnActiveMonitor(direction: Direction): void {
        maybeLog("begin  switchActiveWorkspace");

        this.initNWorkspaces();

        let wrappers = this.getWindowWrappers();

        maybeLog(`  got ${wrappers.length} windows`);
        wrappers.forEach((it) => {
            maybeLog(it.toString());
        });

        let focusedMonitorIndex = this.getFocusedMonitor();

        let windowsToMove = wrappers
            .filter((it) => it.isNormal())
            .filter((it) => it.getInitialMonitorIndex() === focusedMonitorIndex);

        maybeLog(" those windows will be moved: ");
        windowsToMove.forEach((it) => {
            maybeLog(it.toString());
        });

        windowsToMove.forEach((it) => this.moveToDirection(it, direction));
    }

    private getWindowWrappers(): WindowWrapper[] {
        return global.get_window_actors().map((x) => new WindowWrapper(x));
    }

    private getFocusedMonitor(): number {
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

    private initNWorkspaces(): void {
        this.nWorkspaces = global.workspace_manager.get_n_workspaces();
        maybeLog(`  workspacesService.nWorkspaces: ${this.nWorkspaces} `);
    }

    private moveToDirection(windowWrapper: WindowWrapper, direction: Direction): void {
        let nextWorkspace = (this.nWorkspaces + windowWrapper.getWorkspaceIndex() + direction) % this.nWorkspaces;
        maybeLog(`window: ${windowWrapper.getTitle()} will be moved to  workspace will be ${nextWorkspace}`);
        windowWrapper.moveToWorkSpace(nextWorkspace);
    }

    private getActiveWorkspaceIndex(): number {
        return global.workspace_manager.get_active_workspace_index();
    }
}

class Controller {
    private workspaceService: WorkSpacesService;
    private readonly gsettings: Gio.Settings;

    constructor(workspaceService: WorkSpacesService, settings: Gio.Settings) {
        this.workspaceService = workspaceService;
        this.gsettings = settings;
    }

    up(): void {
        this.workspaceService.switchWorkspaceOnActiveMonitor(Direction.UP);
    }

    down(): void {
        this.workspaceService.switchWorkspaceOnActiveMonitor(Direction.DOWN);
    }

    getGSettings(): Gio.Settings {
        return this.gsettings;
    }
}

class ConfigurationService {
    private readonly appActivateHasRightImplementation: boolean;
    private readonly activateWindowHasRightImplementation: boolean;
    private staticWorkspaces: boolean;
    private spanDisplays: boolean;
    private readonly PROBLEM_APPACTIVATE: string;
    private readonly PROBLEM_STATIC_WORKSPACES: string;
    private readonly PROBLEM_SPAN_DISPLAYS: string;

    private warningMenu: {
        menu: PanelMenu.Button,
        item: PopupMenu.PopupMenuItem,
        text: string | null,
    } | null;

    constructor() {
        this.appActivateHasRightImplementation = false;
        this.activateWindowHasRightImplementation = false;
        this.staticWorkspaces = false;
        this.spanDisplays = false;
        this.warningMenu = null;

        this.PROBLEM_APPACTIVATE = "- Another incompatible extension is active. Please disable the other extensions and restart gnome-shell";
        this.PROBLEM_STATIC_WORKSPACES = `- The option "Static Workspaces" is not active`;
        this.PROBLEM_SPAN_DISPLAYS = `- The option "Workspaces span displays" is not active`;
    }

    conditionallyEnableAutomaticSwitching(): void {
        this.staticWorkspaces = !Meta.prefs_get_dynamic_workspaces();
        this.spanDisplays = !Meta.prefs_get_workspaces_only_on_primary();
        maybeLog(this.toString());
    }

    automaticSwitchingIsEnabled(): boolean {
        return this.staticWorkspaces && this.spanDisplays;
    }

    eventuallyShowWarningMenu(): void {
        if (!this.automaticSwitchingIsEnabled()) {
            this.showWarningMenu();
        } else {
            this.eventuallyDestroyWarningMenu();
        }
    }

    eventuallyDestroyWarningMenu(): void {
        maybeLog("warningMenu should be removed");
        if (this.warningMenu !== null) {
            maybeLog("destroying warningMenu");
            this.warningMenu.menu.destroy();
            this.warningMenu = null;
        }
    }

    private showWarningMenu(): void {
        maybeLog("warningMenu should be shown");
        if (this.warningMenu === null) {
            maybeLog("building warning menu");
            let warningMenu = new PanelMenu.Button(0.0, _("simulate-switching-workspaces-on-active-monitor"));
            let warningSymbol = new St.Label({
                text: "\u26a0",  // ⚠, warning
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            warningMenu.add_child(warningSymbol);

            if (!(warningMenu.menu instanceof PopupMenu.PopupMenu)) {
                // `PanelMenu.Button` should be created with a `PopupMenu.PopupMenu` unless the third parameter
                // `dontCreateMenu` is set to `true` which is not the case (above).
                throw new Error("This should not have happened. `PanelMenu.Button.menu` is not of type `PopupMenu.PopupMenu`.");
            }

            warningMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            let warningItem = new PopupMenu.PopupMenuItem("just a placeholder text");
            warningMenu.menu.addMenuItem(warningItem);

            maybeLog("adding the warning menu to the status area");
            Main.panel.addToStatusArea("drive-menu", warningMenu);

            this.warningMenu = {
                menu: warningMenu,
                item: warningItem,
                text: null,
            };
        }
        let text = this.getProblems();
        if (text !== this.warningMenu.text) {
            this.warningMenu.item.label.set_text(text);
            this.warningMenu.text = text;
        }
    }

    getProblems(): string {
        let list: string[] = [];
        if (!(this.appActivateHasRightImplementation && this.activateWindowHasRightImplementation)) {
            list.push(this.PROBLEM_APPACTIVATE);
        }
        if (!this.staticWorkspaces) {
            list.push(this.PROBLEM_STATIC_WORKSPACES);
        }
        if (!this.spanDisplays) {
            list.push(this.PROBLEM_SPAN_DISPLAYS);
        }
        return `Switch workspaces on active monitor can't work properly, because of the following issues:\n\n${list.join("\n")}`;
    }

    toString(): string {
        return `
                automaticSwitchingIsEnabled: ${this.automaticSwitchingIsEnabled()} 
                appActivateHasRightImplementation: ${this.appActivateHasRightImplementation} 
                activateWindowHasRightImplementation: ${this.activateWindowHasRightImplementation} 
                staticWorkspaces: ${this.staticWorkspaces}
                spanDisplays: ${this.spanDisplays}
                `;
    }
}

function maybeLog(value: string): void {
    if (DEBUG_ACTIVE) {
        console.log(value);
    }
}

export default class SwitchWorkspacesExtension extends Extension {
    private state: {
        controller: Controller,
        workspaceService: WorkSpacesService,
        configurationService: ConfigurationService,
        workSpaceChangedListener: number,
    } | null = null;

    enable(): void {
        if (this.state !== null) {
            return;
        }

        let configurationService = new ConfigurationService();
        configurationService.conditionallyEnableAutomaticSwitching();
        configurationService.eventuallyShowWarningMenu();

        let workspaceService = new WorkSpacesService(configurationService);
        let controller = new Controller(workspaceService, this.getSettings());

        let workSpaceChangedListener = global.workspace_manager.connect("active-workspace-changed", () => {
            configurationService.conditionallyEnableAutomaticSwitching();
            configurationService.eventuallyShowWarningMenu();
            workspaceService.switchToPreviouslyActiveWorkspaceOnInactiveMonitors();
        });

        this.addKeybinding(controller);
        configurationService.conditionallyEnableAutomaticSwitching();

        this.state = {
            controller,
            workspaceService,
            configurationService,
            workSpaceChangedListener,
        };

        maybeLog("enabled");
    }

    disable(): void {
        if (this.state === null) {
            return;
        }

        this.removeKeybinding();

        global.workspace_manager.disconnect(this.state.workSpaceChangedListener);

        this.state.configurationService.eventuallyDestroyWarningMenu();

        this.state = null;
        maybeLog("disabled");
    }

    addKeybinding(controller: Controller): void {
        let modeType = Shell.ActionMode.ALL;

        Main.wm.addKeybinding(HOTKEY_NEXT, controller.getGSettings(), Meta.KeyBindingFlags.NONE, modeType, controller.up.bind(controller));

        Main.wm.addKeybinding(HOTKEY_PREVIOUS, controller.getGSettings(), Meta.KeyBindingFlags.NONE, modeType, controller.down.bind(controller));
    }

    removeKeybinding(): void {
        Main.wm.removeKeybinding(HOTKEY_NEXT);
        Main.wm.removeKeybinding(HOTKEY_PREVIOUS);
    }
}

# gnome-shell-extension-simulate-switching-workspaces-on-active-monitor

(almost) allows to have separate workspaces on multiple monitors

#### Details 

After you switch to a different workspace(by using the preview, or by selecting an app on the dock), the windows on the monitors that don't have the focus are moved to the visible workspace.  
So it looks like you are switching workspaces only on the active monitor, leaving the others unchanged.

![Alt text](screenshot.png?raw=true "Screenshot")

#### Prerequisites

* The option "Workspaces span displays"  from tweaks must be active.
* The option "Static Workspaces" must be active.

#### Hot keys

* `Ctrl+Alt+q` Switch to the previous workspace on the active monitor
* `Ctrl+Alt+a` Switch to the next workspace on the active monitor


## Install

* ```make install```
* restart gnome shell


## GNOME 45 notes

Some of the APIs required for this extension are now gone.
Because of this, the extension can no longer easily know what is the currently focused window,
and now assumes your mouse pointer is on the monitor you want to switch.


schemas:
	glib-compile-schemas simulate-switching-workspaces-on-active-monitor@micheledaros.com/schemas/

submit: schemas
	cd simulate-switching-workspaces-on-active-monitor@micheledaros.com/ && zip -r ~/arrangeWindows.zip *

install:
	rm -rf ~/.local/share/gnome-shell/extensions/simulate-switching-workspaces-on-active-monitor@micheledaros.com
	cp -r simulate-switching-workspaces-on-active-monitor@micheledaros.com ~/.local/share/gnome-shell/extensions/

